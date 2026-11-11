"""Pure movement metrics: no database, no web framework, only numbers in and numbers out.

- signal: resampling to a fixed rate, zero-phase low-pass filtering, speed and angular speed.
- sparc: SPARC smoothness, step for step as the web app (web/src/metrics/sparc.ts).
- kinematics: reach timings and path measures from a RAW trajectory.
- aggregate: robust per-session summaries.

Trajectories are rows of [t_ms, x_sw, y_sw] in the body frame (origin at the affected shoulder,
unit one shoulder width); angle series are rows of [t_ms, degrees].
"""
