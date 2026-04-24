# Dev server: exclude project_models from reload watches.
# MLflow copies .py files into project_models/.../code/ during training; without
# --reload-exclude, WatchFiles restarts uvicorn mid-train and breaks training.
Set-Location $PSScriptRoot
python -m uvicorn saas_api:app --reload --reload-exclude "project_models"
