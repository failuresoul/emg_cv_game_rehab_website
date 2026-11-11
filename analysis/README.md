# Analysis

Offline analysis of exported session metrics and events, kept separate from the running application. Do not commit patient data here.

## Engine simulation study

`run_simulation.py` compares the difficulty engines (L0, L1, L2) on simulated patients, through the server's real engines and safety layer. It writes CSVs and figures to `results/simulation/`, and with `--doc` the report in [docs/simulation-results.md](../docs/simulation-results.md). The data are synthetic: no patient data.

```powershell
server\.venv\Scripts\python.exe -m pip install -r analysis\requirements.txt
server\.venv\Scripts\python.exe analysis\run_simulation.py --doc docs\simulation-results.md
```

`--quick` runs 20 patients per group for a check in under a minute.
