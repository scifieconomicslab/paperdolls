[out:json][timeout:300];
rel(58258);
map_to_area->.a;
(
  rel(58258);                         // the boundary itself, so the ingest can clip to it
  way["building"](area.a);
  rel["building"](area.a);
  way["highway"](area.a);
  way["railway"="tram"](area.a);
  way["leisure"~"^(park|garden|playground|pitch|recreation_ground|nature_reserve|common|dog_park|golf_course)$"](area.a);
  rel["leisure"~"^(park|garden|playground|pitch|recreation_ground|nature_reserve|common|dog_park|golf_course)$"](area.a);
  way["landuse"~"^(grass|meadow|forest|orchard|cemetery|recreation_ground|village_green|allotments|reservoir|basin|plaza|flowerbed)$"](area.a);
  rel["landuse"~"^(grass|meadow|forest|orchard|cemetery|recreation_ground|village_green|allotments|reservoir|basin|plaza|flowerbed)$"](area.a);
  way["natural"~"^(water|wood|scrub|grassland|heath|tree_row|wetland|sand|bare_rock|beach)$"](area.a);
  rel["natural"~"^(water|wood|wetland|sand|bare_rock|beach)$"](area.a);
  way["waterway"="riverbank"](area.a);
  way["place"="square"](area.a);
  rel["place"="square"](area.a);
  node["natural"="tree"](area.a);
);
out geom;
