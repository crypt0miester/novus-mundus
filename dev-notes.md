 gm claude, I'm building a world map in a game. I would love to use current cities maps. but the problem is if I did that with location grid (0.0001° = ~11m cells),
  it would require huge amount of data. I'm thinking of making the world map a view of all the cities that the game has. and the cities themselves are circular in
  nature (display) but when clicked it is circular as well and it would have a different view. inside the city itself I would want to have a merkle tree like data
  that tells the chain that these places cannot be used as location because they are either a mountain or water area. you get what I'm saying? how would we resolve
  this? this is my original scrapped design '/Users/k/solana/game/vig-internal/docs/TERRAIN_MERKLE_DESIGN.md'

## Terrain Builder — GLB Asset Pipeline

After downloading/generating new GLB building models (e.g. from Tripo3D), run the optimizer
to decimate meshes and compress textures before using them in the town preview:

```bash
cd sdks/novus-mundus-ts/terrain-builder

# optimize all GLB files in src/town/assets/buildings/
cd sdks/novus-mundus-ts/terrain-builder && bun run optimize:buildings

# optimize a single file
./scripts/optimize-buildings.sh academy_t1.glb

# custom ratio (default 0.01 = keep 1% of vertices)
RATIO=0.05 ./scripts/optimize-buildings.sh

# custom texture size (default 512px)
TEX_SIZE=1024 ./scripts/optimize-buildings.sh
```

Originals are backed up to `src/town/assets/buildings/originals/`.
Tripo3D models are ~40-50 MB / 1.2M vertices each — the optimizer brings them down to ~200 KB-1 MB.