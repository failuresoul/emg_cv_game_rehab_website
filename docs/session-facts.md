# Session facts

`GET /api/sessions/{id}/facts` returns the facts of one session for the LLM feedback module
(`server/app/feedback/`, integrated on Day 16). The module words its feedback from these facts
alone.

- **Who can read them:** the patient who owns the session, or an admin. Anyone else gets `404`; no login gets `401`.
- **Privacy:** the facts hold codes, numbers and short labels only. They never hold the patient's name or email, nor the questionnaire's free-text comment. The patient is identified only by their code (`P001`).
- **Language:** the patient's language (`en` or `bn`) is included, so the module can answer in it.

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `session_id` | integer | The session |
| `patient_code` | string | The patient's code, such as `P001` |
| `session_no` | integer | This session's place among the patient's sessions (all statuses), from 1 |
| `language` | `"en"` \| `"bn"` | The patient's language |
| `affected_side` | `"left"` \| `"right"` | The affected side |
| `duration_min` | number \| null | Start to end, in minutes; `null` while the session is open or for one abandoned without an end |
| `baseline_available` | boolean | At least two completed sessions came before this one, so changes can be judged |
| `games` | object | For each game played: `{ "trials": n, "success_rate": share or null, "level_start": 1–10 or null, "level_end": 1–10 or null }`, leaving out stopped trials. `level_start` is the difficulty level the game began at in this session (its first play) and `level_end` the level it reached (its last play); both are null when the game ran with fixed settings. Shown to the patient as "Level reached: 6 (started at 5)" |
| `metrics` | array (at most 8) | This session's measures against the patient's baseline; see below |
| `directions` | object | `{ "weak": [deg], "strong": [deg] }`: Reach and squeeze directions (0 outward, 45 up and out, 90 up, …) with a success rate below 0.5 (weak) or above 0.85 (strong) in this session |
| `flags.compensation_rate` | number \| null | Share of trials with compensation flagged (trunk, lean, shoulder hike or upper arm); `null` without trials |
| `flags.fatigue_flag` | boolean | The questionnaire's fatigue raised the `high_fatigue` safety flag (8 or more of 10) |
| `flags.hand_loss_pct` | number \| null | Share of the movement trials' time with the hand not tracked (gaps over 200 ms between points), 0–100; `null` without trajectories |
| `self_report` | object \| null | `{ "pain_0_10", "fatigue_0_10", "enjoyment_1_5" }` from the questionnaire; `null` before it is sent |
| `adherence` | object | `{ "sessions_this_week": n, "planned_this_week": n }`: completed sessions from Monday up to this session's day (UTC), and the patient's weekly goal |
| `next_session` | null | The next session's plan; always `null` until the planner (Day 13) |
| `safety_notice_present` | boolean | The session raised a `pain` or `new_symptoms` safety flag. The feedback must then include the safety notice and must not encourage more effort |

### `metrics`

Each item is one measure of the [metrics catalogue](../shared/metrics-catalog.json), as stored for this session (`SessionMetric`). Trial measures are per game.

| Field | Meaning |
| --- | --- |
| `id`, `name`, `unit` | From the catalogue, such as `K6`, "Movement time", `ms` |
| `game_id` | The game a trial measure comes from; `null` for session measures |
| `value` | This session's value |
| `baseline` | The mean of the first two completed sessions with the measure; `null` before there are two |
| `change_mdc` | The change from the baseline in minimal-detectable-change units, **positive when better** whichever way the measure improves (lower movement time, SPARC nearer 0, higher reach); `null` without a baseline |
| `mdc_status` | `improved` (`change_mdc` ≥ 1), `worse` (≤ −1), `no_detectable_change`, or `no_baseline` (fewer than three sessions with the measure) |

**Order:** measures that `improved` or got `worse` come first, largest change first. Key measures that did not change follow, in this order: G1, K6, K7, K8, R1, R3, H1, H5, H3, K1, then the rest. The list stops at 8. Pain, fatigue and enjoyment are in `self_report`, not here.

**The MDC values are provisional placeholders** (`server/app/core/mdc.py`) until they are measured on Day 19. A status says only whether a change is larger than a measure's usual session-to-session noise. It says nothing about whether the change matters clinically, and feedback must not present it as a clinical finding.

## Example

```json
{
  "session_id": 42,
  "patient_code": "P001",
  "session_no": 7,
  "language": "bn",
  "affected_side": "left",
  "duration_min": 31.5,
  "baseline_available": true,
  "games": {
    "reach_activate": { "trials": 20, "success_rate": 0.85, "level_start": 5, "level_end": 6 },
    "balloon_pop": { "trials": 20, "success_rate": 0.75, "level_start": 4, "level_end": 4 },
    "bloom": { "trials": 15, "success_rate": 0.8, "level_start": 3, "level_end": 4 },
    "pick_place": { "trials": 12, "success_rate": 0.67, "level_start": 5, "level_end": 5 }
  },
  "metrics": [
    {
      "id": "K6", "game_id": "reach_activate", "name": "Movement time",
      "value": 1120.0, "baseline": 1480.0, "unit": "ms",
      "change_mdc": 2.4, "mdc_status": "improved"
    },
    {
      "id": "K1", "game_id": null, "name": "Reach area",
      "value": 1.62, "baseline": 1.31, "unit": "sw2",
      "change_mdc": 2.067, "mdc_status": "improved"
    },
    {
      "id": "H5", "game_id": "pick_place", "name": "Pick-and-place transport time",
      "value": 2950.0, "baseline": 2400.0, "unit": "ms",
      "change_mdc": -1.375, "mdc_status": "worse"
    },
    {
      "id": "G1", "game_id": null, "name": "Overall game success rate",
      "value": 0.78, "baseline": 0.74, "unit": "share",
      "change_mdc": 0.4, "mdc_status": "no_detectable_change"
    },
    {
      "id": "K7", "game_id": "reach_activate", "name": "Path efficiency",
      "value": 0.84, "baseline": 0.82, "unit": "share",
      "change_mdc": 0.4, "mdc_status": "no_detectable_change"
    },
    {
      "id": "K8", "game_id": "reach_activate", "name": "Smoothness (SPARC)",
      "value": -1.62, "baseline": -1.75, "unit": "sparc",
      "change_mdc": 0.433, "mdc_status": "no_detectable_change"
    },
    {
      "id": "R1", "game_id": null, "name": "Shoulder raise forward: best angle",
      "value": 112.0, "baseline": 108.0, "unit": "deg",
      "change_mdc": 0.5, "mdc_status": "no_detectable_change"
    },
    {
      "id": "H1", "game_id": null, "name": "Hand opening range",
      "value": 0.52, "baseline": 0.48, "unit": "palm_ratio",
      "change_mdc": 0.4, "mdc_status": "no_detectable_change"
    }
  ],
  "directions": { "weak": [90, 135], "strong": [0, 45] },
  "flags": { "compensation_rate": 0.12, "fatigue_flag": false, "hand_loss_pct": 3.4 },
  "self_report": { "pain_0_10": 1, "fatigue_0_10": 4, "enjoyment_1_5": 4 },
  "adherence": { "sessions_this_week": 3, "planned_this_week": 5 },
  "next_session": null,
  "safety_notice_present": false
}
```

The schema is `SessionFacts` in `server/app/schemas/metrics.py`; its tests are in `server/tests/test_session_facts.py`.
