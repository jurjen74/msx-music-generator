// ────────────────────────────────────────────────────────────────────────────
// MSXgl example (lVGM variant): play a *light-VGM* track, the MSX-optimized,
// heavily compressed form of VGM (typically 75-85% smaller than plain VGM).
// Produce music_lvgm.h from a .vgm with MSXgl's MSXzip tool:
//     MSXzip your.vgm -lVGM -c -o music_lvgm.h -t g_Music
//
// Build (from MSXgl/projects/samples/, after copying these files there):
//     bash build.sh s_mymusic_lvgm           (Windows: build.bat s_mymusic_lvgm)
// Run (PSG):       openmsx -machine C-BIOS_MSX2+ -cart out/s_mymusic_lvgm.rom
// Run (MSX-Music): openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart out/s_mymusic_lvgm.rom
// ────────────────────────────────────────────────────────────────────────────
#include "msxgl.h"
#include "psg.h"
#include "vgm/lvgm_player.h"
#if (LVGM_USE_SCC)
	#include "scc.h"
#endif
#if (LVGM_USE_MSXMUSIC)
	#include "msx-music.h"
#endif
#if (LVGM_USE_MSXAUDIO)
	#include "msx-audio.h"
#endif

// Your music as a compressed lVGM C array (g_Music[]), made with MSXzip -lVGM
#include "music_lvgm.h"

#define MSX_GL "\x02\x03\x04\x05"
#include "font/font_mgl_sample8.h"

//-----------------------------------------------------------------------------
// Program entry point
void main()
{
	// Screen
	VDP_SetMode(VDP_MODE_SCREEN1);
	VDP_SetColor2(COLOR_BLACK, COLOR_WHITE);
	VDP_ClearVRAM();
	VDP_EnableVBlank(TRUE);

	// Init the chips the lVGM player can drive (compiled in via LVGM_USE_*)
	#if (LVGM_USE_SCC)
		SCC_Initialize();
	#endif
	#if (LVGM_USE_MSXMUSIC)
		MSXMusic_Initialize();
	#endif
	#if (LVGM_USE_MSXAUDIO)
		MSXAudio_Initialize();
	#endif

	// Title
	Print_SetTextFont(g_Font_MGL_Sample8, 1);
	Print_DrawText(MSX_GL " MY MSX MUSIC (lVGM)");
	Print_DrawLineH(0, 1, 32);

	// Start playing (loop = TRUE) and report what the header decoded to
	bool ok = LVGM_Play(g_Music, TRUE);

	Print_SetPosition(0, 3);
	Print_DrawFormat("Loaded:  %s\n", ok ? "OK" : "INVALID");
	Print_DrawFormat("Freq:    %i Hz\n", (g_LVGM_Header->Option & LVGM_OPTION_50HZ) ? 50 : 60);
	Print_DrawFormat("PSG:     %c\n", (LVGM_GetDevices() & LVGM_CHIP_PSG) ? '\x0C' : '\x0B');
	Print_DrawFormat("MSX-Mus: %c\n", (LVGM_GetDevices() & LVGM_CHIP_OPLL) ? '\x0C' : '\x0B');
	Print_DrawFormat("Size:    %i bytes\n", (u16)sizeof(g_Music));

	Print_SetPosition(0, 10);
	Print_DrawText("Playing (lVGM), looping...");

	// Main loop: advance the player once per frame (60 Hz)
	u8 anim = 0;
	while (1)
	{
		Halt();          // wait for VBlank
		LVGM_Decode();   // play one frame of lVGM
		#if (PSG_ACCESS == PSG_INDIRECT)
		PSG_Apply();
		#endif

		Print_SetPosition(31, 0);
		Print_DrawChar("|/-\\"[(anim++ >> 3) & 3]);
	}
}
