-- Safely drop legacy, unused material return tables if they exist
DROP TABLE IF EXISTS material_return_items CASCADE;
DROP TABLE IF EXISTS material_return CASCADE;
