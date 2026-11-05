"""Overture Places for the study-area bbox → data/raw/overture_places.parquet (local evidence only, never shipped).
Used by 07_areas.py to describe each mahalle's street life (bars, cafés, mosques, wholesale, offices, parks...).
Release pinned for reproducibility."""
import duckdb

from lib import BBOX, DATA

RELEASE = "2026-10-21.0"
S, W, N, E = BBOX
out = DATA / "raw" / "overture_places.parquet"
c = duckdb.connect()
c.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
c.execute(f"""
COPY (
  -- 2026 schema: taxonomy.primary / hierarchy replace the old categories struct
  SELECT id, names.primary AS name, taxonomy.primary AS cat, basic_category AS basic,
         array_to_string(taxonomy.hierarchy, '>') AS hier, operating_status AS status, confidence,
         ST_X(geometry) AS lon, ST_Y(geometry) AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN {W} AND {E} AND bbox.ymin BETWEEN {S} AND {N} AND confidence >= 0.5
) TO '{out.as_posix()}' (FORMAT parquet)""")
n, cats = c.execute(f"SELECT count(*), count(DISTINCT cat) FROM '{out.as_posix()}'").fetchone()
print(f"overture places: {n} ({cats} categories) → {out}")
print(c.execute(f"SELECT cat, count(*) n FROM '{out.as_posix()}' GROUP BY 1 ORDER BY 2 DESC LIMIT 40").fetchall())
