# Agent Datasets (Starter Pack)

These CSVs are meant to be uploaded into the recommender UI (or used by your agents) to train the existing model types:

- `content` and `parameter_driven`: use the `*_content.csv` file
- `collaborative` and `hybrid`: use the `*_interactions.csv` file

## Column conventions

- Content datasets include:
  - `item_id` (string or numeric)
  - `item_title` (human readable name)
  - feature columns (any other columns you choose)
  - `category` (optional target candidate)
- Interaction datasets include:
  - `user_id`
  - `item_id`
  - `rating` (typically 1-5)

## Suggested model mappings

### Content model (`content`)
Use `*_content.csv`:
- `item_id` -> `item_id`
- `item_title` -> `item_title`
- `feature_cols` -> pick any of the other columns (common picks: `brand/model/fuel_type/body_style/year` for cars; `genres/year/director/language` for movies; `artist/genre/year/tempo_bpm/danceability/energy` for songs)

### Parameter-driven model (`parameter_driven`)
Use `*_content.csv`:
- `target_column` -> pick `category` (recommended) or another column (e.g. `brand`, `genre`)
- `feature_cols` -> pick any subset of the remaining columns

### Collaborative model (`collaborative`)
Use `*_interactions.csv`:
- `user_id` -> `user_id`
- `item_id` -> `item_id`
- `rating` -> `rating`

### Hybrid model (`hybrid`)
Use:
- Content part: `*_content.csv` (with `item_id`, `item_title`, and `feature_cols`)
- Ratings part: `*_interactions.csv` (with `item_id` and `rating`)

