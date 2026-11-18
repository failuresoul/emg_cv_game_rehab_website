# EMG recordings

The 30 s CSV recordings from `/dev/emg-monitor` ("Record 30 s CSV") are saved here by the development server. `analysis/emg/emg_validation.py` reads every `*.csv` in this folder.

- **Format:** `web/src/dev/emgMonitor/recording.ts` (metadata lines, then `t_ms,arrival_ms,counter,mv,envelope_mv,phase,cue`).
- **Labels:** use a patient code (for example `P001-flexors-gain5`), never a name. These files are committed with the analysis data.
- **What counts:** only real sensor recordings count in the results; mock-board and `SIM ON` recordings are listed but left out.
