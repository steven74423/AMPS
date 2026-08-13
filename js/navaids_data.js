// 資料來源: enr4-1_navaids.json (ENR 4.1 無線電助航設施-航路)
const NAVAIDS_DATA = {
  "source": "R.O.C. Taiwan CAA eAIP AIRAC AIP AMDT 03/26, effective 06 AUG 2026",
  "section": "ENR 4.1 無線電助航設施－航路",
  "source_url": "https://ais.caa.gov.tw/eaip/AIRAC%20AIP%20AMDT%2003-26_2026_08_06/eAIP/RC-ENR%204.1-zh-TW.html#ENR-4.1",
  "coordinate_note": "coordinates 為 [經度, 緯度] (WGS84, GeoJSON [lon,lat] 順序)",
  "count": 14,
  "navaids": [
    {
      "id": "AP",
      "name": "ANBU",
      "type": "NDB",
      "freq": "250.00 KHZ",
      "magnetic_variation": "04° W",
      "coordinates": [
        121.5225,
        25.175833
      ],
      "elevation_ft": null,
      "remarks": ""
    },
    {
      "id": "APU",
      "name": "ANBU",
      "type": "VOR/DME",
      "freq": "112.50 MHZ (CH72X)",
      "magnetic_variation": "04° W",
      "coordinates": [
        121.522222,
        25.176944
      ],
      "elevation_ft": 3594,
      "remarks": "VOR因受地形影響，幅向115-315之間區域，儀表指示可能有暫時擺動"
    },
    {
      "id": "HCN",
      "name": "HENGCHUN",
      "type": "VOR/DME",
      "freq": "113.70 MHZ (CH84X)",
      "magnetic_variation": null,
      "coordinates": [
        120.843611,
        21.927778
      ],
      "elevation_ft": 403,
      "remarks": "VOR因地形關係，輻向322-342於40NM外、6000FT以下不能使用"
    },
    {
      "id": "HL",
      "name": "HOULONG",
      "type": "NDB",
      "freq": "362.00 KHZ",
      "magnetic_variation": null,
      "coordinates": [
        120.730278,
        24.563611
      ],
      "elevation_ft": null,
      "remarks": ""
    },
    {
      "id": "HLG",
      "name": "HOULONG",
      "type": "VOR/DME",
      "freq": "114.00 MHZ (CH87X)",
      "magnetic_variation": null,
      "coordinates": [
        120.727222,
        24.559722
      ],
      "elevation_ft": 575,
      "remarks": ""
    },
    {
      "id": "YU",
      "name": "HUALIEN",
      "type": "NDB",
      "freq": "380.00 KHZ",
      "magnetic_variation": null,
      "coordinates": [
        121.627222,
        24.017778
      ],
      "elevation_ft": null,
      "remarks": ""
    },
    {
      "id": "HLN",
      "name": "HUALIEN",
      "type": "VOR/DME",
      "freq": "114.10 MHZ (CH88X)",
      "magnetic_variation": null,
      "coordinates": [
        121.640278,
        24.018611
      ],
      "elevation_ft": 124,
      "remarks": "輻向220-020不能使用，輻向175-190不可靠"
    },
    {
      "id": "BS",
      "name": "KINMEN",
      "type": "NDB",
      "freq": "345.00 KHZ",
      "magnetic_variation": null,
      "coordinates": [
        118.349167,
        24.426389
      ],
      "elevation_ft": null,
      "remarks": ""
    },
    {
      "id": "GI",
      "name": "LUDAO",
      "type": "NDB",
      "freq": "300.00 KHZ",
      "magnetic_variation": null,
      "coordinates": [
        121.483056,
        22.676111
      ],
      "elevation_ft": null,
      "remarks": ""
    },
    {
      "id": "GID",
      "name": "LUDAO",
      "type": "VOR/DME",
      "freq": "116.90 MHZ (CH116X)",
      "magnetic_variation": null,
      "coordinates": [
        121.486111,
        22.6725
      ],
      "elevation_ft": 572,
      "remarks": "輻向140-190於40NM外、8500FT以下不能使用，輻向245-360於30NM外不能使用"
    },
    {
      "id": "MKG",
      "name": "MAGONG",
      "type": "VOR/DME",
      "freq": "115.20 MHZ (CH99X)",
      "magnetic_variation": null,
      "coordinates": [
        119.637222,
        23.595556
      ],
      "elevation_ft": 77,
      "remarks": ""
    },
    {
      "id": "NKN",
      "name": "MATSU/NANGAN",
      "type": "DME",
      "freq": "CH38X",
      "magnetic_variation": null,
      "coordinates": [
        119.957222,
        26.159444
      ],
      "elevation_ft": 375,
      "remarks": "輻向220-020不能使用"
    },
    {
      "id": "NK",
      "name": "MATSU/NANGAN",
      "type": "NDB",
      "freq": "315.00 KHZ",
      "magnetic_variation": null,
      "coordinates": [
        119.955278,
        26.155278
      ],
      "elevation_ft": null,
      "remarks": ""
    },
    {
      "id": "TNN",
      "name": "SIGANG",
      "type": "VOR/DME",
      "freq": "113.30 MHZ (CH80X)",
      "magnetic_variation": null,
      "coordinates": [
        120.206111,
        23.135278
      ],
      "elevation_ft": 46,
      "remarks": ""
    }
  ]
}
;

