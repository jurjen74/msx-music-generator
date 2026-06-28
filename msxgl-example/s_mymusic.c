// ────────────────────────────────────────────────────────────────────────────
// MSXgl example: play a single VGM produced by the MSX MML Music Generator
// (Claude → MML → VGM). Works with both PSG (AY-3-8910) and MSX-Music (YM2413)
// VGM files exported by the web app. Loops forever.
//
// Build (from MSXgl/projects/samples/, after copying these files there):
//     bash build.sh s_mymusic
// Run (PSG):       openmsx -machine C-BIOS_MSX2+ -cart out/s_mymusic.rom
// Run (MSX-Music): openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart out/s_mymusic.rom
// ────────────────────────────────────────────────────────────────────────────
#include "msxgl.h"
#include "psg.h"
#include "vgm/vgm_player.h"
#if (VGM_USE_SCC)
	#include "scc.h"
#endif
#if (VGM_USE_MSXMUSIC)
	#include "msx-music.h"
#endif
#if (VGM_USE_MSXAUDIO)
	#include "msx-audio.h"
#endif

// Your music, generated with: node tools/bin2c.mjs your.vgm music_vgm.h g_Music
#include "music_vgm.h"

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

	// Init the chips the VGM player can drive (compiled in via VGM_USE_*)
	#if (VGM_USE_SCC)
		SCC_Initialize();
	#endif
	#if (VGM_USE_MSXMUSIC)
		MSXMusic_Initialize();
	#endif
	#if (VGM_USE_MSXAUDIO)
		MSXAudio_Initialize();
	#endif

	// Title
	Print_SetTextFont(g_Font_MGL_Sample8, 1);
	Print_DrawText(MSX_GL " MY MSX MUSIC");
	Print_DrawLineH(0, 1, 32);

	// Start playing (loop = TRUE) and report what the header decoded to
	bool ok = VGM_Play(g_Music, TRUE);

	Print_SetPosition(0, 3);
	Print_DrawFormat("Header:  %s\n", ok ? "OK" : "INVALID");
	Print_DrawFormat("Version: %1x.%1x%1x\n",
		(u8)(g_VGM_Header->Version >> 8) & 0xF,
		(u8)(g_VGM_Header->Version >> 4) & 0xF,
		(u8)(g_VGM_Header->Version) & 0xF);
	Print_DrawFormat("PSG:     %c\n", VGM_ContainsPSG() ? '\x0C' : '\x0B');
	Print_DrawFormat("MSX-Mus: %c\n", VGM_ContainsMSXMusic() ? '\x0C' : '\x0B');
	Print_DrawFormat("Size:    %i bytes\n", (u16)sizeof(g_Music));

	Print_SetPosition(0, 10);
	Print_DrawText("Playing, looping...");

	// Main loop: advance the player once per frame (60 Hz)
	u8 anim = 0;
	while (1)
	{
		Halt();          // wait for VBlank
		VGM_Decode();    // play one frame of VGM
		#if (PSG_ACCESS == PSG_INDIRECT)
		PSG_Apply();
		#endif

		Print_SetPosition(31, 0);
		Print_DrawChar("|/-\\"[(anim++ >> 3) & 3]);
	}
}
