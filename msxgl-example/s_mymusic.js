//*****************************************************************************
// PROJECT CONFIG OVERWRITE — single-VGM player ROM (PSG or MSX-Music)
//*****************************************************************************

//-- Target MSX machine version (string)
Machine = "1";

//-- Target program format (string). ROM_32K is plenty for a single short track.
Target = "ROM_32K";

//-- Library modules. Includes every chip the VGM player can drive, so the same
//-- ROM plays both PSG and MSX-Music (and SCC / MSX-Audio) VGM files.
LibModules = [ "psg", "scc", "msx-music", "msx-audio", "vgm/vgm_player", ...LibModules ];

//-- Application ID
AppID = "MM";
