#!/usr/bin/env python3
"""Build an optimized binary glTF (GLB) from robot.xml and STL meshes.

Creates a compact, low-draw-call 3D model for MARBLE-web:
- Node 0: Root ('MARBLE_Robot')
- Node 1: Frame (static internal frame, electronics capsule, carbon fiber rods, motors)
- Node 2: Slider_X (linear mass slider along X axis [-1, 0, 0])
- Node 3: Slider_Y (linear mass slider along Y axis [0, 1, 0])
- Node 4: Slider_Z (linear mass slider along Z axis [0, 0, -1])
- Node 5: Shell (semi-transparent outer shell)
"""

import os
import sys
import math
import struct
import json
import xml.etree.ElementTree as ET

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
XML_PATH = os.path.join(REPO_ROOT, "robot.xml")
OUTPUT_GLB = os.path.join(REPO_ROOT, "media", "models", "marble.glb")

# Source STL directory (can be overridden by environment variable)
STL_DIR = os.environ.get("STL_DIR", os.path.join(REPO_ROOT, "..", "Coding", "legged_env_dev", "asset", "ball_linear_complex", "meshes"))

# --- Math Utilities ---

def parse_vec(s, default="0 0 0"):
    return [float(x) for x in (s or default).split()]

def parse_quat(s):
    # MuJoCo quat is [w, x, y, z]
    if not s:
        return [1.0, 0.0, 0.0, 0.0]
    return [float(x) for x in s.split()]

def quat_mult(q1, q2):
    w1, x1, y1, z1 = q1
    w2, x2, y2, z2 = q2
    return [
        w1*w2 - x1*x2 - y1*y2 - z1*z2,
        w1*x2 + x1*w2 + y1*z2 - z1*y2,
        w1*y2 - x1*z2 + y1*w2 + z1*x2,
        w1*z2 + x1*y2 - y1*x2 + z1*w2
    ]

def quat_rot(q, v):
    w, x, y, z = q
    vx, vy, vz = v
    # q_vec x v
    cx = y * vz - z * vy
    cy = z * vx - x * vz
    cz = x * vy - y * vx
    # q_vec x (q_vec x v)
    ccx = y * cz - z * cy
    ccy = z * cx - x * cz
    ccz = x * cy - y * cx
    return [
        vx + 2.0 * (w * cx + ccx),
        vy + 2.0 * (w * cy + ccy),
        vz + 2.0 * (w * cz + ccz)
    ]

# --- STL Parser ---

def read_stl(path, decimate_factor=1):
    """Read binary or ASCII STL into a list of triangles (each is 3 tuples of (x,y,z))."""
    if not os.path.exists(path):
        return []
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 84:
        return []

    num_tris = struct.unpack("<I", data[80:84])[0]
    expected_size = 84 + num_tris * 50

    triangles = []
    if len(data) == expected_size:
        # Binary STL
        offset = 84
        for i in range(num_tris):
            if decimate_factor > 1 and (i % decimate_factor != 0):
                offset += 50
                continue
            # Normal (12 bytes), V1 (12), V2 (12), V3 (12), attr (2)
            n = struct.unpack("<3f", data[offset:offset+12])
            v1 = struct.unpack("<3f", data[offset+12:offset+24])
            v2 = struct.unpack("<3f", data[offset+24:offset+36])
            v3 = struct.unpack("<3f", data[offset+36:offset+48])
            triangles.append((v1, v2, v3, n))
            offset += 50
    else:
        # Try ASCII STL
        try:
            text = data.decode("utf-8", errors="ignore")
            lines = text.splitlines()
            cur_verts = []
            cur_norm = (0.0, 0.0, 0.0)
            tri_idx = 0
            for line in lines:
                parts = line.strip().split()
                if not parts:
                    continue
                if parts[0] == "facet" and parts[1] == "normal":
                    cur_norm = (float(parts[2]), float(parts[3]), float(parts[4]))
                elif parts[0] == "vertex":
                    cur_verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
                elif parts[0] == "endfacet":
                    if len(cur_verts) == 3:
                        if decimate_factor <= 1 or (tri_idx % decimate_factor == 0):
                            triangles.append((cur_verts[0], cur_verts[1], cur_verts[2], cur_norm))
                        tri_idx += 1
                    cur_verts = []
        except Exception:
            pass

    return triangles

# --- Mesh Geometry Assembly ---

class GeometryGroup:
    def __init__(self, name, material_name):
        self.name = name
        self.material_name = material_name
        self.positions = []   # flat floats [x, y, z, ...]
        self.normals = []     # flat floats [nx, ny, nz, ...]
        self.indices = []     # uint32 indices
        self.vert_map = {}    # (rounded_pos, rounded_norm) -> index
        self.min_pos = [1e9, 1e9, 1e9]
        self.max_pos = [-1e9, -1e9, -1e9]

    def add_triangle(self, v1, v2, v3, norm=None):
        if norm is None or (norm[0] == 0 and norm[1] == 0 and norm[2] == 0):
            ax, ay, az = v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]
            bx, by, bz = v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]
            nx = ay * bz - az * by
            ny = az * bx - ax * bz
            nz = ax * by - ay * bx
            mag = math.sqrt(nx*nx + ny*ny + nz*nz)
            if mag > 1e-8:
                norm = (nx/mag, ny/mag, nz/mag)
            else:
                norm = (0.0, 1.0, 0.0)

        tri_indices = []
        for v in (v1, v2, v3):
            key = (round(v[0], 5), round(v[1], 5), round(v[2], 5),
                   round(norm[0], 2), round(norm[1], 2), round(norm[2], 2))
            idx = self.vert_map.get(key)
            if idx is None:
                idx = len(self.positions) // 3
                self.vert_map[key] = idx
                self.positions.extend(v)
                self.normals.extend(norm)
                for i in range(3):
                    if v[i] < self.min_pos[i]: self.min_pos[i] = v[i]
                    if v[i] > self.max_pos[i]: self.max_pos[i] = v[i]
            tri_indices.append(idx)
        self.indices.extend(tri_indices)


def main():
    print(f"Reading XML: {XML_PATH}")
    tree = ET.parse(XML_PATH)
    root = tree.getroot()

    mesh_files = {}
    mesh_scales = {}
    for m in root.findall(".//asset/mesh"):
        name = m.attrib["name"]
        f = m.attrib.get("file", f"meshes/{name}.stl")
        mesh_files[name] = os.path.basename(f)
        scale_str = m.attrib.get("scale", "0.001 0.001 0.001")
        mesh_scales[name] = parse_vec(scale_str)

    materials = {
        "mat_PA_12_Nylon_PA_603_CF_with_EOS_P_3D_Prin": ([0.22, 0.22, 0.23, 1.0], 0.1, 0.7, "OPAQUE"),
        "mat_ABS_White": ([0.95, 0.95, 0.94, 1.0], 0.05, 0.5, "OPAQUE"),
        "mat_Carbon_Fiber_Plain": ([0.28, 0.28, 0.30, 1.0], 0.2, 0.4, "OPAQUE"),
        "mat_Stainless_Steel_Satin": ([0.82, 0.82, 0.84, 1.0], 0.85, 0.3, "OPAQUE"),
        "mat_Aluminum_Satin": ([0.92, 0.92, 0.94, 1.0], 0.75, 0.35, "OPAQUE"),
        "mat_Steel_Satin": ([0.65, 0.65, 0.68, 1.0], 0.85, 0.35, "OPAQUE"),
        "mat_Plastic_Glossy_Black": ([0.18, 0.18, 0.18, 1.0], 0.1, 0.2, "OPAQUE"),
        "mat_Opaque_229_234_237": ([0.88, 0.90, 0.92, 1.0], 0.5, 0.4, "OPAQUE"),
        "mat_Opaque_229_234_237_2": ([0.88, 0.90, 0.92, 1.0], 0.2, 0.6, "OPAQUE"),
        "mat_Rubber_Soft": ([0.12, 0.12, 0.12, 1.0], 0.0, 0.9, "OPAQUE"),
        "mat_ABS_White_2": ([0.94, 0.96, 0.98, 0.42], 0.05, 0.2, "BLEND"),
        "mat_Slider_Weight": ([0.75, 0.60, 0.25, 1.0], 0.9, 0.25, "OPAQUE"),
        "mat_Slider_Carriage": ([0.90, 0.92, 0.94, 1.0], 0.7, 0.35, "OPAQUE"),
        "mat_Slider_Bearing": ([0.98, 0.98, 1.0, 1.0], 0.95, 0.15, "OPAQUE"),
        "mat_Slider_Hardware": ([0.75, 0.75, 0.78, 1.0], 0.8, 0.4, "OPAQUE"),
        "default": ([0.7, 0.7, 0.7, 1.0], 0.2, 0.5, "OPAQUE"),
    }

    nodes_data = {
        "Frame": {},
        "Slider_X": {},
        "Slider_Y": {},
        "Slider_Z": {},
        "Shell": {}
    }

    world = root.find("worldbody")
    base_link = world.find("./body[@name='base_link']")

    stl_cache = {}

    def get_stl_triangles(mesh_name):
        if mesh_name in stl_cache:
            return stl_cache[mesh_name]
        filename = mesh_files.get(mesh_name, f"{mesh_name}.stl")
        # Ensure we use .stl if .obj was specified in xml
        if filename.endswith(".obj"):
            filename = filename[:-4] + ".stl"
        path = os.path.join(STL_DIR, filename)

        # Smart decimation based on part type and raw triangle count
        # Tiny screws, internal chips, and high-density CAD models are decimated
        # so total robot model is ~3MB, ensuring extremely low lag on the website.
        decimate = 1
        if os.path.exists(path) and path.endswith(".stl"):
            with open(path, "rb") as f:
                if f.seek(80) == 80:
                    raw_n = struct.unpack("<I", f.read(4))[0]
                    target_max = 1500
                    if any(x in filename for x in ["Screw", "SCREWS", "92125", "92290", "90666", "93935", "97163", "Nut", "Bolt"]):
                        target_max = 300
                    elif "BGA" in filename or "orange_pi" in filename:
                        target_max = 400
                    elif "Ball_Bearing" in filename or "Bearing" in filename:
                        target_max = 1000
                    elif "V4_1" in filename:
                        target_max = 3000
                    decimate = max(1, math.ceil(raw_n / target_max))

        tris = read_stl(path, decimate_factor=decimate)
        scale = mesh_scales.get(mesh_name, [0.001, 0.001, 0.001])
        scaled_tris = []
        for v1, v2, v3, n in tris:
            sv1 = (v1[0] * scale[0], v1[1] * scale[1], v1[2] * scale[2])
            sv2 = (v2[0] * scale[0], v2[1] * scale[1], v2[2] * scale[2])
            sv3 = (v3[0] * scale[0], v3[1] * scale[1], v3[2] * scale[2])
            scaled_tris.append((sv1, sv2, sv3, n))
        stl_cache[mesh_name] = scaled_tris
        return scaled_tris

    def process_geom(geom, body_pos, body_quat, group_target):
        mesh_name = geom.attrib.get("mesh")
        if not mesh_name:
            return
        g_pos = parse_vec(geom.attrib.get("pos"))
        g_quat = parse_quat(geom.attrib.get("quat"))

        gw_pos = [body_pos[i] + quat_rot(body_quat, g_pos)[i] for i in range(3)]
        gw_quat = quat_mult(body_quat, g_quat)

        mat = geom.attrib.get("material")
        if not mat:
            if mesh_name == "Weight":
                mat = "mat_Slider_Weight"
            elif mesh_name == "base":
                mat = "mat_Slider_Carriage"
            elif "Bearing" in mesh_name:
                mat = "mat_Slider_Bearing"
            elif "Bolt" in mesh_name or "Pillow" in mesh_name:
                mat = "mat_Slider_Hardware"
            else:
                mat = "default"

        tris = get_stl_triangles(mesh_name)
        if not tris:
            return

        target_dict = nodes_data[group_target]
        if mat not in target_dict:
            target_dict[mat] = GeometryGroup(f"{group_target}_{mat}", mat)
        geo = target_dict[mat]

        for v1, v2, v3, n in tris:
            tv1 = [gw_pos[i] + quat_rot(gw_quat, v1)[i] for i in range(3)]
            tv2 = [gw_pos[i] + quat_rot(gw_quat, v2)[i] for i in range(3)]
            tv3 = [gw_pos[i] + quat_rot(gw_quat, v3)[i] for i in range(3)]
            tn = quat_rot(gw_quat, n) if n else None
            geo.add_triangle(tv1, tv2, tv3, tn)

    def traverse(body, parent_pos, parent_quat, current_group):
        name = body.attrib.get("name", "")
        b_pos = parse_vec(body.attrib.get("pos"))
        b_quat = parse_quat(body.attrib.get("quat"))
        world_pos = [parent_pos[i] + quat_rot(parent_quat, b_pos)[i] for i in range(3)]
        world_quat = quat_mult(parent_quat, b_quat)

        group = current_group
        if name == "base-2":
            group = "Slider_Z"
        elif name == "base-1":
            group = "Slider_Y"
        elif name == "base":
            group = "Slider_X"
        elif "V4_1_" in name:
            group = "Shell"

        for geom in body.findall("geom"):
            process_geom(geom, world_pos, world_quat, group)

        for child in body.findall("body"):
            traverse(child, world_pos, world_quat, group)

    print("Traversing XML scene graph and assembling component geometries...")
    traverse(base_link, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], "Frame")

    for k, v in nodes_data.items():
        total_v = sum(len(g.positions)//3 for g in v.values())
        total_f = sum(len(g.indices)//3 for g in v.values())
        print(f"  - {k}: {len(v)} materials, {total_v:,} vertices, {total_f:,} triangles")

    print("Packing into GLB format...")

    bin_buffer = bytearray()
    buffer_views = []
    accessors = []
    meshes = []
    gltf_nodes = []
    gltf_materials = []
    mat_index_map = {}

    def get_material_index(mat_name):
        if mat_name in mat_index_map:
            return mat_index_map[mat_name]
        props = materials.get(mat_name, materials["default"])
        color, metal, rough, alpha = props
        mat_def = {
            "name": mat_name,
            "pbrMetallicRoughness": {
                "baseColorFactor": color,
                "metallicFactor": metal,
                "roughnessFactor": rough
            }
        }
        if alpha == "BLEND":
            mat_def["alphaMode"] = "BLEND"
            mat_def["doubleSided"] = True
        idx = len(gltf_materials)
        gltf_materials.append(mat_def)
        mat_index_map[mat_name] = idx
        return idx

    def add_buffer_view_and_accessor(data, target, component_type, count, acc_type, min_val=None, max_val=None):
        while len(bin_buffer) % 4 != 0:
            bin_buffer.append(0)
        offset = len(bin_buffer)
        bin_buffer.extend(data)
        byte_len = len(data)

        bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": byte_len,
            "target": target
        })

        acc = {
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": component_type,
            "count": count,
            "type": acc_type
        }
        if min_val is not None: acc["min"] = min_val
        if max_val is not None: acc["max"] = max_val
        acc_idx = len(accessors)
        accessors.append(acc)
        return acc_idx

    node_names = ["Frame", "Slider_X", "Slider_Y", "Slider_Z", "Shell"]
    child_node_indices = []

    for name in node_names:
        groups = nodes_data[name]
        primitives = []
        for mat_name, geo in groups.items():
            if not geo.indices:
                continue
            mat_idx = get_material_index(mat_name)

            pos_bytes = struct.pack(f"<{len(geo.positions)}f", *geo.positions)
            pos_acc = add_buffer_view_and_accessor(
                pos_bytes, 34962, 5126, len(geo.positions) // 3, "VEC3",
                geo.min_pos, geo.max_pos
            )

            norm_bytes = struct.pack(f"<{len(geo.normals)}f", *geo.normals)
            norm_acc = add_buffer_view_and_accessor(
                norm_bytes, 34962, 5126, len(geo.normals) // 3, "VEC3"
            )

            idx_bytes = struct.pack(f"<{len(geo.indices)}I", *geo.indices)
            idx_acc = add_buffer_view_and_accessor(
                idx_bytes, 34963, 5125, len(geo.indices), "SCALAR"
            )

            primitives.append({
                "attributes": {
                    "POSITION": pos_acc,
                    "NORMAL": norm_acc
                },
                "indices": idx_acc,
                "material": mat_idx
            })

        mesh_idx = len(meshes)
        meshes.append({
            "name": f"Mesh_{name}",
            "primitives": primitives
        })

        node_idx = len(gltf_nodes) + 1
        gltf_nodes.append({
            "name": name,
            "mesh": mesh_idx
        })
        child_node_indices.append(node_idx)

    all_nodes = [{
        "name": "MARBLE_Robot",
        "children": child_node_indices
    }] + gltf_nodes

    gltf_dict = {
        "asset": {
            "version": "2.0",
            "generator": "MARBLE_Robot_GLB_Builder"
        },
        "scene": 0,
        "scenes": [{
            "nodes": [0]
        }],
        "nodes": all_nodes,
        "meshes": meshes,
        "materials": gltf_materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{
            "byteLength": len(bin_buffer)
        }]
    }

    json_str = json.dumps(gltf_dict, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '

    while len(bin_buffer) % 4 != 0:
        bin_buffer += b'\x00'

    total_glb_len = 12 + (8 + len(json_bytes)) + (8 + len(bin_buffer))

    glb_data = bytearray()
    glb_data.extend(struct.pack("<4sII", b"glTF", 2, total_glb_len))
    glb_data.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    glb_data.extend(json_bytes)
    glb_data.extend(struct.pack("<II", len(bin_buffer), 0x004E4942))
    glb_data.extend(bin_buffer)

    os.makedirs(os.path.dirname(OUTPUT_GLB), exist_ok=True)
    with open(OUTPUT_GLB, "wb") as f:
        f.write(glb_data)

    print(f"Successfully exported GLB to: {OUTPUT_GLB}")
    print(f"File size: {len(glb_data) / (1024*1024):.2f} MB ({len(glb_data):,} bytes)")

if __name__ == "__main__":
    main()
