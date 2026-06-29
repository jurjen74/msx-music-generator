//*****************************************************************************
// PROJECT CONFIG OVERWRITE — two-track lVGM player (SPACE to switch)
//*****************************************************************************

//-- Target MSX machine version (string)
Machine = "1";

//-- Target program format (string)
Target = "ROM_32K";

//-- Library modules (lVGM player + all chips it can drive + input for SPACE)
LibModules = [ "psg", "scc", "msx-music", "msx-audio", "vgm/lvgm_player", ...LibModules ];

//-- Application ID
AppID = "M2";
