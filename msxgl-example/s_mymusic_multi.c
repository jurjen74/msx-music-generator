// ────────────────────────────────────────────────────────────────────────────
// MSXgl example (multi-song lVGM): embeds two tracks and switches between them
// with SPACE. Built from two .lvgm files exported by the MSX MML Music Generator.
// Make the headers with:  node tools/bin2c.mjs a.lvgm music1_lvgm.h g_Music1
//                         node tools/bin2c.mjs b.lvgm music2_lvgm.h g_Music2
//
// Build (from MSXgl/projects/samples/): bash build.sh s_mymusic_multi
// Run:  openmsx -machine C-BIOS_MSX2+ -ext fmpac -cart out/s_mymusic_multi.rom
//       (-ext fmpac is needed for any MSX-Music/FM track)
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

#include "music1_lvgm.h" // g_Music1
#include "music2_lvgm.h" // g_Music2

#define MSX_GL "\x02\x03\x04\x05"
#include "font/font_mgl_sample8.h"

const u8* const g_Songs[2] = { g_Music1, g_Music2 };
const c8* const g_Names[2] = { "1. Title (PSG)   ", "2. Title (FM)    " };
u8 g_Cur = 0;

//-----------------------------------------------------------------------------
void PlaySong(u8 idx)
{
	g_Cur = idx;
	LVGM_Stop();
	LVGM_Play(g_Songs[idx], TRUE);

	Print_SetPosition(0, 5);
	Print_DrawFormat("Now playing: %s\n", g_Names[idx]);
	Print_DrawFormat("PSG:%c  MSX-Music:%c        \n",
		(LVGM_GetDevices() & LVGM_CHIP_PSG) ? '\x0C' : '\x0B',
		(LVGM_GetDevices() & LVGM_CHIP_OPLL) ? '\x0C' : '\x0B');
}

//-----------------------------------------------------------------------------
void main()
{
	VDP_SetMode(VDP_MODE_SCREEN1);
	VDP_SetColor2(COLOR_BLACK, COLOR_WHITE);
	VDP_ClearVRAM();
	VDP_EnableVBlank(TRUE);

	#if (LVGM_USE_SCC)
		SCC_Initialize();
	#endif
	#if (LVGM_USE_MSXMUSIC)
		MSXMusic_Initialize();
	#endif
	#if (LVGM_USE_MSXAUDIO)
		MSXAudio_Initialize();
	#endif

	Print_SetTextFont(g_Font_MGL_Sample8, 1);
	Print_DrawText(MSX_GL " MY MSX MUSIC x2");
	Print_DrawLineH(0, 1, 32);
	Print_SetPosition(0, 3);
	Print_DrawText("SPACE = switch track");

	PlaySong(0);

	u8 prev = 0xFF;
	u8 anim = 0;
	while (1)
	{
		Halt();
		LVGM_Decode();
		#if (PSG_ACCESS == PSG_INDIRECT)
		PSG_Apply();
		#endif

		u8 row8 = Keyboard_Read(8);
		if (IS_KEY_PRESSED(row8, KEY_SPACE) && !IS_KEY_PRESSED(prev, KEY_SPACE))
			PlaySong(g_Cur ^ 1);
		prev = row8;

		Print_SetPosition(31, 0);
		Print_DrawChar("|/-\\"[(anim++ >> 3) & 3]);
	}
}
