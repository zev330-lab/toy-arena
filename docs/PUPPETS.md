# Puppets: jointed, puffy 3D toys (v2 figures)

Goal (owner, 2026-09-27): toys stop being flat standees glued to a base that hop at each other.
They stand on their own feet, walk, and move their limbs (punch with arms, kick with legs,
dance, high-five), and look properly 3D.

## Pipeline (photo → puppet)

1. **Cutout** (unchanged): front RGBA cutout + contour, optional fitted back photo.
2. **Auto-rig** `js/core/rig.js` (pure, unit-tested): downsample the alpha mask → distance
   transform (thickness) → Zhang–Suen thinning → skeleton graph → prune spurs → find feet
   (leaves near the ground) → pelvis = where the two legs meet → spine = heaviest path upward →
   arms = long side branches off the spine → head = spine top, neck = narrowest spine point →
   everything else = wiggly appendages (tails, horns, antennae, weapons).
   Falls back to a template skeleton (legs split down the middle, no arms) when the silhouette
   is not conclusive. Result stored on the toy as `rig` (joint tree in cutout pixels).
3. **Puppet mesh** `js/core/puppet.js` (pure, unit-tested): marching-squares triangulation of
   the alpha field (interior vertices everywhere, boundary on the alpha = 0.5 contour) →
   Poisson inflation (∇²f = −1, f = 0 on the silhouette; height = √(2f), "Monster Mash"
   style) for round cross-sections → front + back surfaces meeting at the silhouette →
   skin weights from geodesic (inside-the-mask) distance to each bone segment.
4. **Three.js** `js/mesh.js`: `SkinnedMesh` (front photo / back photo materials) + an
   inverted-hull ink outline sharing the skeleton. No base.
5. **Animation** `js/figure.js`: layered procedural poses on the bones — idle breathing, fighting
   stance, walk / run cycles driven by distance travelled, punch, kick, block, hit reactions,
   flop KO, get-up, jump, victory, bow, dance styles, wave, high-five, hug, tickle; feet are
   snapped to the ground; toys without legs hop.

## Rig format (`toy.rig`)

```
{ v, auto, kind: 'humanoid'|'blob', w, h,
  joints: { name: { x, y, parent } } }   // cutout px, y down; parent = joint name or null
```
Standard names: hips (root), chest, neck, head (tip), shoulderL/elbowL/handL,
shoulderR/elbowR/handR, hipL/kneeL/footL, hipR/kneeR/footR ("L" = image left);
appendages app{i}_{k}. A joint's bone owns the segment from the joint to its child.
