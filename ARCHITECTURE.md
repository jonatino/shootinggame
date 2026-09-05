# Game runtime layout

`index.html` owns only markup, styling, third-party scripts, and the ordered runtime script list. Game code lives under `js/`.

| File | Responsibility |
| --- | --- |
| `settings.js` | Validated, persisted control and graphics preferences; loaded before the renderer |
| `core.js` | Renderer, scene, audio, shared state, broadphase helpers, and reusable effects |
| `destruction.js` | Structural cooking, fracture handoff, support integration, and voxel promotion |
| `world.js` | Map construction, voxel props, NPC creation, and pickups |
| `combat.js` | Weapons, rockets, explosions, hit detection, and structural damage |
| `climbing.js` | Surface sampling and traversal graph generation |
| `player-controller.js` | Input, player collision, traversal state, and movement |
| `player-character.js` | Character mesh, weapon rig, IK animation, and camera |
| `ui-effects.js` | HUD feedback and short-lived visual effects |
| `rigid-body.js` | Dynamic debris contacts, swept OBB collision, support, settling, fracture release, and solver scratch state |
| `actors.js` | Enemy, dummy, pickup, and projectile updates |
| `game-loop.js` | Fixed simulation clock, interpolated player presentation, profiling, pause/resume, and startup |

`voxel_physics.js` remains a standalone destruction engine loaded before these files.

## Load-order rule

The runtime uses ordered classic scripts. Files share top-level bindings and must stay in the order listed in `index.html`. New subsystem code should go in the narrowest matching file; avoid adding gameplay code back to `index.html`.

## Simulation and presentation

World units are metres. `WORLD_GRAVITY` in `core.js` is 9.81 m/s² and is passed to
the voxel engine; rockets, rigid debris, players, and enemies use the same value.
The player jump is defined by a 1.3 m height, with launch speed derived from gravity.
The character controller retains deliberately responsive ground acceleration and
limited air steering.

`simulate()` advances gameplay at 120 Hz. `update()` accumulates elapsed time and
allows at most twelve fixed steps per rendered frame; excess stall time is
discarded, and pausing clears the remainder. Weapon cooldown keeps its fractional
remainder. Camera, character interpolation, GPU instance updates, effects, and HUD
updates happen once per rendered frame. Camera shake does not consume gameplay
randomness. `voxelPhysics.update(dt, true)` defers mesh uploads until `syncVisuals()`;
standalone callers can continue using `update(dt)`.

Fast legacy fragments use swept SAT against static and settled OBBs before the
ordinary contact solver applies impulses, friction, and impact damage. This sweep
handles translation; rotation and moving-body contacts are resolved at the fixed
step. Loose voxel contacts use a sweep axis chosen from the particle distribution,
and mixed body contacts exclude already-solved loose/loose pairs.

Loose fragments integrate normalized quaternions and constant-gravity trajectories.
Fast fragments sweep their rotated AABB against intact voxel cells; slow contacts
query the full bounds and separate along exposed faces of contiguous occupied
cells. Internal seams, including adjoining building tiers, cannot act as ledges.
This remains a conservative box approximation, not
an exact rotating polyhedron sweep. Static friction is capped by the normal
impulse, and restitution is disabled below the resting-speed threshold. Cached
occupied bounds shrink after destruction so empty tower space costs fewer queries.
The mixed contact grid packs coordinates into exact numeric keys, with an
out-of-range fallback for custom worlds.

Sleeping rubble retains a support chain ending at ground, an intact voxel, or a
settled legacy body. The chain is checked once per step with memoization; recycled
particle slots have distinct identities. Moving or deleting support wakes the
dependent pile. Rest damping also requires this support path, so collisions
within an airborne rubble cloud preserve its gravitational acceleration.
Sound generation has an independent random stream and reuses
immutable noise buffers, so muting never changes gameplay randomness.
Settled fragments retain their size instead of regenerating full building cells;
sleeping bodies remain bounded by the existing rubble pool.

Detached sections also integrate rotation from their current quaternion. Hits
release a pivot while preserving its current pose and tangential velocity, then
add linear and angular impulses. Changing a spin axis never reapplies accumulated
rotation to the original pose. Static contacts project out the overlapping surface
and apply impulses and bounded friction while preserving tangential motion.
Touching a vertical wall cannot roll back the section's falling displacement.
Contacts between detached sections use the colliding cells to choose the contact
normal. Whole-body centres cannot identify the solid side of hollow shells or
interlocking floors; using them reversed contacts and ejected building cores.

## Controls and preferences

Escape, focus loss, and losing an acquired mouse lock pause and clear input.
Resuming requires an explicit play action. Right-drag remains available when the
browser declines mouse lock. The pause screen saves sensitivity, invert Y, camera
motion, held jumps, and graphics quality in local storage. Missing or invalid
storage falls back to defaults. Graphics presets change pixel density and shadows;
they do not alter simulation quality or collision rules.

The camera retracts immediately at hard obstructions and extends smoothly when
space clears. Walkable ground requires a surface normal within about 50 degrees
of level; step-up attempts also check headroom. Enemy bullets have pooled,
interpolated orange tracers released on impact or expiration. Pickups use 3D reach
and line of sight, preserve health packs at full health, and show an interaction
prompt. Unlimited ammunition makes ammo drops redundant, so these are health packs.
