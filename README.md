# Mass Fraction

A rocket design, fabrication and launch game built on real engineering. You design every part from first principles, make each one through actual manufacturing steps, find (or miss) the defects, test, integrate, and launch. Start with a solid-fuel sounding rocket and work up to orbit.

**Play:** https://asherhawk-school.github.io/mass-fraction/

## What makes it realistic

- **Design from physics, not stats.** Engine performance comes from thermochemistry and nozzle flow. Tanks are sized from hoop stress, weld joint efficiency and shell buckling. Fins can flutter, nose cones overheat, and stability comes from the Barrowman method. Masses come from geometry × material.
- **Liquid engines:** regenerative cooling (Bartz heat flux, coolant-channel solver, coking limits), injector stiffness and combustion instability, pressure-fed / electric / gas-generator / expander / staged-combustion cycles, pump NPSH and bearing limits.
- **Solid motors:** burn-rate law, grain regression (BATES, star, finocyl), temperature sensitivity, erosive burning, throat erosion. Voids, cracks and debonds can burst the case.
- **Fabrication:** about 40 real process steps (welding, heat treatment, composite cure, propellant mixing, metal 3D printing, balancing…), each with a hidden process window. Qualify a procedure with test coupons to learn the window. Inspections (dye penetrant, X-ray, ultrasonic, CT…) find each defect type only some of the time. A material review board decides repair, rework, use-as-is or scrap.
- **Testing:** burst tests, solid-motor static fires, liquid-engine hot-fires with redlines, vibration tests, parachute ground tests.
- **Flight:** 3-DOF simulation around a rotating Earth using the 1976 Standard Atmosphere, wind shear and turbulence, a TVC autopilot, gravity turn and closed-loop linear-tangent guidance, staging and ullage settling, navigation drift (with consumer GPS cutting off at the COCOM limits), range-safety destruct, parachute recovery and orbit insertion.
- **Operations:** launch licensing, weather forecasts and launch commit criteria, countdown, and a post-flight investigation that traces each failure to the exact part and process step that caused it.

## Run locally

It uses ES modules, so serve it from a local web server rather than opening the file directly:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Tests

The physics is checked against published reference values (Merlin-1D, F-1, RL10, AJ10, the 1976 Standard Atmosphere, two-body orbit propagation, and full flights):

```bash
npm test
```

No dependencies, no build step: vanilla JavaScript and Canvas 2D.
