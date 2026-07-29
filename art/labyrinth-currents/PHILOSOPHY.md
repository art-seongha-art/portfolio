# Labyrinth Currents

*An algorithmic philosophy for living water*

---

## I. The Movement

**Labyrinth Currents** holds that a creature is not a shape but a *sequence of consequences*. Nothing in this movement is drawn; everything is **propagated**. A single point of intent moves through black water, and every other point in the composition — every vertebra, every fin ray, every translucent membrane spanning between rays — learns its position from the point ahead of it, one frame late. Form is the visible residue of delay. Beauty is what happens when propagation is tuned so precisely that the eye reads intention where there is only lag.

The name comes from the labyrinth organ: the folded chamber that lets certain fish breathe air, forcing them to rise, periodically, out of their own element. This is the movement's governing metaphor. Every system here is a body that must occasionally break its own rules — the wanderer that darts, the hoverer that surges, the veil that goes still and then remembers the water. A perfectly regular algorithm is a dead one. The masterwork lives in the interruption, and the interruption must itself be **meticulously crafted** — arriving neither on a schedule the viewer can predict nor at random intervals the viewer reads as noise.

## II. Propagation, Not Pose

The spine is an angular chain. Each joint holds an angle that chases the angle of the joint ahead of it, offset by a traveling curvature wave whose amplitude grows toward the tail as `u^1.5` and whose frequency binds to locomotor effort. Positions are never integrated directly — they are *reconstructed* from angles at fixed segment lengths, so the body can never stretch, never tear, never betray the illusion of an incompressible animal. This constraint is not a limitation; it is the discipline that makes the result read as flesh. It is the product of deep computational expertise to know that the cheapest way to look real is to make the impossible unrepresentable.

Fins are ropes: pinned at the root, free at the tip, solved by Verlet integration with distance constraints and a graded bend stiffness that softens toward the edge. They are never keyframed and never scripted. A halfmoon caudal fin trailing eighteen ray-chains behind a turning body produces, without a single line of authored animation, the exact heavy silk lag that anyone who has watched a betta will recognize instantly and never be able to name. The membrane between adjacent rays is not a texture — it is the quad strip that *falls out* of two neighboring solutions. **Painstaking optimization** of damping, segment stiffness curves, and ambient noise forcing is what separates a flag from a fin.

## III. Counter-Shading, Iridescence, Interference

Color obeys light, not palette. Against absolute black, a body must be lit from a single implied surface above: the dorsal ridge falls to near-extinction, the upper flank carries the specular band, the belly counter-shades pale and cool. Iridescence is modeled as it physically occurs — thin-film interference — as a hue rotation driven by the local body normal against a slow noise field, so that shimmer travels *along* the animal as it turns rather than sitting on it as decoration. Scale rows are individual arcs whose brightness samples that same field, and the fin membranes carry a root-to-edge hue migration from body color to margin color, opacity decaying as `1 − 0.75·t^1.5`. Every one of these exponents is a tuned constant, arrived at through countless iterations, and every one of them is load-bearing.

## IV. Volume Without a Third Dimension

The animal is laterally compressed, so its lateral compression is the depth cue. A single signed `flip` scalar carries both the mirroring of the body across its own axis and the foreshortening of that axis. When the fish reverses, `flip` passes through zero: widths collapse toward a sliver, the dorsal fan flattens into the backward direction, the caudal spread narrows — and the viewer sees a three-dimensional roll performed entirely in two dimensions by one variable. This is the movement's central act of **master-level implementation**: refuse the extra dimension, then extract it from geometry that was already there.

The water is likewise inferred rather than depicted. Persistence of the previous frame gives the silk of a long exposure. Additive shafts descending from an unseen surface, drifting motes with parallax bound to depth, a shimmer line at the ceiling of the world, and bubbles that rise, wobble, and accumulate into a slow raft of breath — none of these are water, and together they are nothing else.

## V. Behavior as Composition

Nothing in this work is choreographed and nothing is arbitrary. Motion emerges from competing drives resolved each frame by priority: hunger outranks curiosity, curiosity outranks the need to breathe, and beneath all of them a wander field of layered noise keeps the animal from ever tracing the same arc twice. Effort modulates tail-beat amplitude and frequency together, as it does in a real fish, so that a burst *looks* like exertion and a hover *looks* like rest. Proximity raises a flare response — opercular membrane extended, fins spread, body arched — because this species answers a rival with display before violence, and a display is a composition.

Given a seed, the system produces a fixed genome: proportions, veil geometry, ray count and raggedness, hue offset, boldness, wander frequency, the rhythm of the rise to air. The same seed always yields the same animal. It will never yield the same minute. **Process over product** is not a slogan here — it is the literal architecture: the artifact is a living algorithm, and each frame is a discarded byproduct of it running well.

## VI. The Standard

This algorithm must feel as though it took countless hours to develop, because it did. The correct response to it is not "what a nice picture of a fish" but a moment of doubt about whether it is a simulation at all. Every damping coefficient, every stiffness falloff, every width-profile control point, every threshold at which a behavior yields to another behavior must be refined with care until the system stops looking tuned and starts looking *alive*. That is the only acceptable finish. Anything less is a diagram.
