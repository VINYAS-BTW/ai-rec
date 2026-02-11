import pandas as pd
import numpy as np
import logging
import io

# Setup logging
logger = logging.getLogger("ETL_Pipeline")
logging.basicConfig(level=logging.INFO)

class ETLProcessor:
    """
    Standardizes arbitrary user CSVs into the strict schema required by the ML models.
    """

    @staticmethod
    def validate_columns(df: pd.DataFrame, required_cols: list):
        """Checks if the user-mapped columns actually exist in the CSV."""
        missing = [col for col in required_cols if col not in df.columns]
        if missing:
            raise ValueError(f"ETL Error: The following mapped columns are missing from the CSV: {missing}")

    @staticmethod
    def transform_interaction_data(df: pd.DataFrame, schema_map: dict) -> pd.DataFrame:
        """
        Cleans interaction data (User-Item-Rating).
        Output Schema: ['user_id', 'item_id', 'rating', 'timestamp' (optional)]
        """
        logger.info("Starting ETL for Interaction Data...")
        
        # 1. Identify User's Columns
        user_col = schema_map.get('user_id')
        item_col = schema_map.get('item_id')
        rating_col = schema_map.get('rating')
        
        if not (user_col and item_col):
             raise ValueError("ETL Error: Interaction schema must contain 'user_id' and 'item_id'.")

        # 2. Validate Existence
        ETLProcessor.validate_columns(df, [user_col, item_col])
        if rating_col:
            ETLProcessor.validate_columns(df, [rating_col])

        # 3. Rename to Internal Standard
        rename_map = {user_col: 'user_id', item_col: 'item_id'}
        if rating_col:
            rename_map[rating_col] = 'rating'
        
        clean_df = df.rename(columns=rename_map)

        # 4. Data Cleaning
        # - Enforce Strings for IDs (handles mixed types like 101 and "101")
        clean_df['user_id'] = clean_df['user_id'].astype(str).str.strip()
        clean_df['item_id'] = clean_df['item_id'].astype(str).str.strip()

        # - Enforce Numeric for Rating
        if 'rating' in clean_df.columns:
            clean_df['rating'] = pd.to_numeric(clean_df['rating'], errors='coerce').fillna(1.0)
        else:
            # If no rating provided (implicit feedback), assume 1
            logger.info("No rating column provided. Creating implicit rating of 1.0")
            clean_df['rating'] = 1.0

        # - Drop nulls only in critical columns
        initial_count = len(clean_df)
        clean_df = clean_df.dropna(subset=['user_id', 'item_id'])
        dropped_count = initial_count - len(clean_df)
        
        if dropped_count > 0:
            logger.warning(f"Dropped {dropped_count} rows due to missing User/Item IDs.")

        logger.info(f"✅ Interaction ETL Complete. Rows: {len(clean_df)}")
        return clean_df[['user_id', 'item_id', 'rating']]

    @staticmethod
    def transform_content_data(df: pd.DataFrame, schema_map: dict) -> pd.DataFrame:
        """
        Cleans content data (Item-Title-Features).
        Output Schema: ['item_id', 'item_title', 'soup']
        """
        logger.info("Starting ETL for Content Data...")

        # 1. Identify Columns
        id_col = schema_map.get('item_id')
        title_col = schema_map.get('item_title')
        feature_cols = schema_map.get('feature_cols', [])

        if not (id_col and title_col):
             raise ValueError("ETL Error: Content schema must contain 'item_id' and 'item_title'.")

        # 2. Validate
        required = [id_col, title_col] + feature_cols
        ETLProcessor.validate_columns(df, required)

        # 3. Rename
        clean_df = df.rename(columns={id_col: 'item_id', title_col: 'item_title'})

        # 4. Cleaning
        clean_df['item_id'] = clean_df['item_id'].astype(str).str.strip()
        clean_df['item_title'] = clean_df['item_title'].astype(str).str.strip()

        # 5. Feature Engineering (The "Soup")
        # Combine all feature columns into one text string for TF-IDF
        logger.info(f"Combining columns {feature_cols} into metadata soup.")
        
        # Fill NaNs with empty string so they don't break the join
        for col in feature_cols:
            clean_df[col] = clean_df[col].fillna("").astype(str)

        clean_df['soup'] = clean_df[feature_cols].agg(' '.join, axis=1)

        # Remove duplicates (One row per item)
        clean_df = clean_df.drop_duplicates(subset=['item_id'])
        
        logger.info(f"✅ Content ETL Complete. Unique Items: {len(clean_df)}")
        return clean_df[['item_id', 'item_title', 'soup']]