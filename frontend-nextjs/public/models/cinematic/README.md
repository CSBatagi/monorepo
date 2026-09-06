# Cinematic CS2 characters

The scene uses the user-supplied SAS and Phoenix Sketchfab downloads. See
[credits.txt](credits.txt) for attribution, source links, and CC BY 4.0 notices.

`node scripts/prepare-cs2-models.mjs <download-directory>` builds these assets
offline using the project's existing Sharp dependency. Original downloads remain
unchanged. The alternate GLB copies are higher-resolution versions of the same
characters, not additional player skins.

| Asset | Bytes | Triangles | Estimated decoded texture memory incl. mipmaps |
| --- | ---: | ---: | ---: |
| sas-mobile.glb | 1,269,308 | 16,469 | 4.67 MiB |
| phoenix-mobile.glb | 1,305,968 | 17,715 | 5.33 MiB |
| sas-desktop.glb | 3,467,952 | 16,469 | 23.33 MiB |
| phoenix-desktop.glb | 4,060,948 | 17,715 | 26.67 MiB |

Mobile uses 512px albedo and two players. Desktop uses up to 1024px albedo,
512px normals, and four players sharing the same two source meshes/textures.
The SAS export contained 394 editor-preview clips, removed during preparation.
Phoenix has no clips. Both rigs use authored analytic limb poses and planted-foot
trajectories. Neither version downloads the original heavyweight exports.

The previous `soldier.glb` is retained as an unused development reference from the
Three.js r180 example (Mixamo credit); its repository license remains in
THREE-LICENSE.txt. It is no longer requested by the scene.
