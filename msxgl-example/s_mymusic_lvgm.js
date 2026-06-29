//*****************************************************************************
// PROJECT CONFIG OVERWRITE — single-track player using lVGM (compact VGM)
//*****************************************************************************

//-- Target MSX machine version (string)
Machine = "1";

//-- Target program format (string)
Target = "ROM_32K";

//-- Library modules. Same chips as the VGM example, but the lVGM player.
LibModules = [ "psg", "scc", "msx-music", "msx-audio", "vgm/lvgm_player", ...LibModules ];

//-- Application ID
AppID = "ML";
