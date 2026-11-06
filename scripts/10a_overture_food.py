"""Overture Places, food & drink only, with the fields needed to judge quality (brand, websites, socials, sources)
→ data/raw/overture_food.parquet (local evidence only; 09_food.py turns it into app data). Release pinned."""
import duckdb

from lib import BBOX, DATA

RELEASE = "2026-10-21.0"
S, W, N, E = BBOX
out = DATA / "raw" / "overture_food.parquet"
c = duckdb.connect()
c.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
c.execute(f"""
COPY (
  SELECT id, names.primary AS name, taxonomy.primary AS cat, basic_category AS basic,
         array_to_string(taxonomy.hierarchy, '>') AS hier, operating_status AS status, confidence,
         brand.names.primary AS brand, len(websites) AS n_web, len(socials) AS n_soc, len(sources) AS n_src,
         list_transform(sources, lambda s: s.dataset) AS datasets,
         ST_X(geometry) AS lon, ST_Y(geometry) AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN {W} AND {E} AND bbox.ymin BETWEEN {S} AND {N} AND confidence >= 0.6
    AND taxonomy.hierarchy[1] = 'food_and_drink'
) TO '{out.as_posix()}' (FORMAT parquet)""")
print(c.execute(f"SELECT count(*), count(DISTINCT cat) FROM '{out.as_posix()}'").fetchone())
print(c.execute(f"SELECT cat, count(*) n FROM '{out.as_posix()}' GROUP BY 1 ORDER BY 2 DESC LIMIT 50").fetchall())
