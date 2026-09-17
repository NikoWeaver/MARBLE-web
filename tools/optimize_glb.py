#!/usr/bin/env python3
"""Optimize marble.glb by decimating dense static frame meshes and repacking into an ultra-low-lag GLB."""

import struct
import json
import os

INPUT_GLB = "media/models/marble.glb"
OUTPUT_GLB = "media/models/marble_opt.glb"

def optimize():
    with open(INPUT_GLB, "rb") as f:
        f.seek(12)
        j_len, _ = struct.unpack("<II", f.read(8))
        gltf = json.loads(f.read(j_len).decode("utf-8"))
        b_len, _ = struct.unpack("<II", f.read(8))
        orig_bin = f.read(b_len)

    new_bin = bytearray()
    new_buffer_views = []
    new_accessors = []
    new_meshes = []

    def add_acc(data, target, comp_type, count, acc_type, min_v=None, max_v=None):
        while len(new_bin) % 4 != 0:
            new_bin.append(0)
        offset = len(new_bin)
        new_bin.extend(data)
        
        bv_idx = len(new_buffer_views)
        new_buffer_views.append({
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(data),
            "target": target
        })
        
        acc = {
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": comp_type,
            "count": count,
            "type": acc_type
        }
        if min_v is not None: acc["min"] = min_v
        if max_v is not None: acc["max"] = max_v
        new_accessors.append(acc)
        return len(new_accessors) - 1

    for mesh in gltf["meshes"]:
        is_frame = "Frame" in mesh["name"]
        new_prims = []
        for prim in mesh["primitives"]:
            pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            norm_acc = gltf["accessors"][prim["attributes"]["NORMAL"]]
            idx_acc = gltf["accessors"][prim["indices"]]

            # Read indices
            ibv = gltf["bufferViews"][idx_acc["bufferView"]]
            ioff = ibv.get("byteOffset", 0) + idx_acc.get("byteOffset", 0)
            icount = idx_acc["count"]
            indices = list(struct.unpack_from(f"<{icount}I", orig_bin, ioff))

            # Read positions
            pbv = gltf["bufferViews"][pos_acc["bufferView"]]
            poff = pbv.get("byteOffset", 0) + pos_acc.get("byteOffset", 0)
            pcount = pos_acc["count"]
            positions = struct.unpack_from(f"<{pcount*3}f", orig_bin, poff)

            # Read normals
            nbv = gltf["bufferViews"][norm_acc["bufferView"]]
            noff = nbv.get("byteOffset", 0) + norm_acc.get("byteOffset", 0)
            normals = struct.unpack_from(f"<{pcount*3}f", orig_bin, noff)

            # Decimate if dense frame mesh
            num_tris = len(indices) // 3
            stride = 1
            if is_frame:
                if num_tris > 4000:
                    stride = 4
                elif num_tris > 2000:
                    stride = 3
                elif num_tris > 1000:
                    stride = 2

            new_indices = []
            used_verts = {}
            new_positions = []
            new_normals = []

            for t in range(0, num_tris, stride):
                i1, i2, i3 = indices[t*3], indices[t*3+1], indices[t*3+2]
                for old_i in (i1, i2, i3):
                    if old_i not in used_verts:
                        new_idx = len(new_positions) // 3
                        used_verts[old_i] = new_idx
                        new_positions.extend(positions[old_i*3 : old_i*3+3])
                        new_normals.extend(normals[old_i*3 : old_i*3+3])
                    new_indices.append(used_verts[old_i])

            # Min/max pos
            min_pos = [min(new_positions[i::3]) for i in range(3)]
            max_pos = [max(new_positions[i::3]) for i in range(3)]

            # Pack
            pos_bytes = struct.pack(f"<{len(new_positions)}f", *new_positions)
            norm_bytes = struct.pack(f"<{len(new_normals)}f", *new_normals)
            idx_bytes = struct.pack(f"<{len(new_indices)}I", *new_indices)

            p_idx = add_acc(pos_bytes, 34962, 5126, len(new_positions)//3, "VEC3", min_pos, max_pos)
            n_idx = add_acc(norm_bytes, 34962, 5126, len(new_normals)//3, "VEC3")
            i_idx = add_acc(idx_bytes, 34963, 5125, len(new_indices), "SCALAR")

            new_prims.append({
                "attributes": {
                    "POSITION": p_idx,
                    "NORMAL": n_idx
                },
                "indices": i_idx,
                "material": prim["material"]
            })

        new_meshes.append({
            "name": mesh["name"],
            "primitives": new_prims
        })

    gltf["meshes"] = new_meshes
    gltf["accessors"] = new_accessors
    gltf["bufferViews"] = new_buffer_views
    gltf["buffers"] = [{"byteLength": len(new_bin)}]

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4 != 0: json_bytes += b' '
    while len(new_bin) % 4 != 0: new_bin += b'\x00'

    total_len = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
    out_data = bytearray()
    out_data.extend(struct.pack("<4sII", b"glTF", 2, total_len))
    out_data.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    out_data.extend(json_bytes)
    out_data.extend(struct.pack("<II", len(new_bin), 0x004E4942))
    out_data.extend(new_bin)

    with open(OUTPUT_GLB, "wb") as f:
        f.write(out_data)

    print(f"Original size: {os.path.getsize(INPUT_GLB)/(1024*1024):.2f} MB")
    print(f"Optimized size: {len(out_data)/(1024*1024):.2f} MB")

if __name__ == "__main__":
    optimize()
