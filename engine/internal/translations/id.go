package translations

func initIndonesianTranslation() {
	translation := createTranslation()

	translation.put("requires-js", "Situs web ini memerlukan JavaScript agar dapat berjalan dengan baik.")

	translation.put("start-the-game", "Bersiap!")
	translation.put("force-start", "Mulai Paksa")
	translation.put("force-restart", "Mulai Ulang Paksa")
	translation.put("game-not-started-title", "Permainan belum dimulai")
	translation.put("waiting-for-host-to-start", "Silakan tunggu host lobi memulai permainan.")
	translation.put("click-to-homepage", "Klik di sini untuk kembali ke Beranda")

	translation.put("now-spectating-title", "Anda sekarang menjadi penonton")
	translation.put("now-spectating-text", "Anda dapat keluar dari mode penonton dengan menekan tombol mata di bagian atas.")
	translation.put("now-participating-title", "Anda sekarang ikut bermain")
	translation.put("now-participating-text", "Anda dapat masuk ke mode penonton dengan menekan tombol mata di bagian atas.")

	translation.put("spectation-requested-title", "Mode penonton diminta")
	translation.put("spectation-requested-text", "Anda akan menjadi penonton setelah giliran ini.")
	translation.put("participation-requested-title", "Partisipasi diminta")
	translation.put("participation-requested-text", "Anda akan ikut bermain setelah giliran ini.")

	translation.put("spectation-request-cancelled-title", "Permintaan mode penonton dibatalkan")
	translation.put("spectation-request-cancelled-text", "Permintaan Anda untuk menjadi penonton telah dibatalkan, Anda akan tetap ikut bermain.")
	translation.put("participation-request-cancelled-title", "Permintaan partisipasi dibatalkan")
	translation.put("participation-request-cancelled-text", "Permintaan Anda untuk ikut bermain telah dibatalkan, Anda akan tetap menjadi penonton.")

	translation.put("round", "Giliran")
	translation.put("toggle-soundeffects", "Aktifkan/nonaktifkan efek suara")
	translation.put("toggle-pen-pressure", "Aktifkan/nonaktifkan tekanan pena")
	translation.put("change-your-name", "Nama panggilan")
	translation.put("randomize", "Acak")
	translation.put("apply", "Terapkan")
	translation.put("save", "Simpan")
	translation.put("toggle-fullscreen", "Aktifkan/nonaktifkan layar penuh")
	translation.put("toggle-spectate", "Aktifkan/nonaktifkan mode penonton")
	translation.put("show-help", "Tampilkan bantuan")
	translation.put("votekick-a-player", "Vote untuk mengeluarkan pemain")

	translation.put("last-turn", "(Giliran terakhir: %s)")

	translation.put("drawer-kicked", "Karena pemain yang dikeluarkan sedang menggambar, tidak ada yang akan mendapatkan poin pada giliran ini.")
	translation.put("self-kicked", "Anda telah dikeluarkan")
	translation.put("kick-vote", "(%s/%s) pemain memilih untuk mengeluarkan %s.")
	translation.put("player-kicked", "Pemain telah dikeluarkan.")
	translation.put("owner-change", "%s adalah pemilik lobi yang baru.")

	translation.put("change-lobby-settings-tooltip", "Ubah pengaturan lobi")
	translation.put("change-lobby-settings-title", "Pengaturan lobi")
	translation.put("lobby-settings-changed", "Pengaturan lobi telah diubah")
	translation.put("advanced-settings", "Pengaturan Lanjutan")
	translation.put("chill", "Santai")
	translation.put("competitive", "Kompetitif")
	translation.put("chill-alt", "Meskipun bermain cepat akan memberikan penghargaan, tidak masalah jika Anda sedikit lebih lambat.\nSkor dasar cukup tinggi, jadi fokuslah untuk bersenang-senang!")
	translation.put("competitive-alt", "Semakin cepat Anda bermain, semakin banyak poin yang Anda dapatkan.\nSkor dasar jauh lebih rendah dan penurunannya lebih cepat.")
	translation.put("score-calculation", "Perhitungan Skor")
	translation.put("word-language", "Bahasa")
	translation.put("drawing-time-setting", "Waktu Menggambar")
	translation.put("rounds-setting", "Jumlah Giliran")
	translation.put("max-players-setting", "Jumlah Pemain Maksimum")
	translation.put("public-lobby-setting", "Lobi Publik")
	translation.put("custom-words", "Kata Kustom")
	translation.put("custom-words-info", "Masukkan kata tambahan Anda, pisahkan dengan koma")
	translation.put("custom-words-placeholder", "Kata, dipisahkan, dengan, koma")
	translation.put("custom-words-per-turn-setting", "Kata Kustom Per Giliran")
	translation.put("players-per-ip-limit-setting", "Batas Pemain Per IP")
	translation.put("words-per-turn-setting", "Kata Per Giliran")
	translation.put("save-settings", "Simpan pengaturan")
	translation.put("input-contains-invalid-data", "Input Anda berisi data yang tidak valid:")
	translation.put("please-fix-invalid-input", "Perbaiki input yang tidak valid dan coba lagi.")
	translation.put("create-lobby", "Buat Lobi")
	translation.put("create-public-lobby", "Buat Lobi Publik")
	translation.put("create-private-lobby", "Buat Lobi Privat")
	translation.put("no-lobbies-yet", "Belum ada lobi.")
	translation.put("lobby-full", "Maaf, lobi sudah penuh.")
	translation.put("lobby-ip-limit-excceeded", "Maaf, Anda telah melebihi jumlah maksimum klien per IP.")
	translation.put("lobby-open-tab-exists", "Sepertinya Anda sudah memiliki tab yang terbuka untuk lobi ini.")
	translation.put("lobby-doesnt-exist", "Lobi yang diminta tidak ada")

	translation.put("refresh", "Muat Ulang")
	translation.put("join-lobby", "Gabung Lobi")

	translation.put("message-input-placeholder", "Ketik tebakan dan pesan Anda di sini")

	translation.put("word-choice-warning", "Kata jika Anda tidak memilih tepat waktu")
	translation.put("choose-a-word", "Pilih sebuah kata")
	translation.put("waiting-for-word-selection", "Menunggu pemilihan kata")
	// This one doesn't use %s, since we want to make one part bold.
	translation.put("is-choosing-word", "sedang memilih sebuah kata.")

	translation.put("close-guess", "'%s' sangat mendekati.")
	translation.put("correct-guess", "Anda berhasil menebak kata dengan benar.")
	translation.put("correct-guess-other-player", "'%s' berhasil menebak kata dengan benar.")
	translation.put("round-over", "Giliran berakhir, tidak ada kata yang dipilih.")
	translation.put("round-over-no-word", "Giliran berakhir, kata tersebut adalah '%s'.")
	translation.put("game-over-win", "Selamat, Anda menang!")
	translation.put("game-over-tie", "Hasilnya seri!")
	translation.put("game-over", "Anda berada di posisi %s. dengan %s poin")
	translation.put("drawer-disconnected", "Giliran berakhir lebih awal, pemain yang menggambar terputus.")
	translation.put("guessers-disconnected", "Giliran berakhir lebih awal, para penebak terputus.")
	translation.put("word-hint-revealed", "Petunjuk kata telah ditampilkan!")

	translation.put("change-active-color", "Ubah warna aktif Anda")
	translation.put("use-pencil", "Gunakan pensil")
	translation.put("use-eraser", "Gunakan penghapus")
	translation.put("use-fill-bucket", "Gunakan ember isian (Mengisi area target dengan warna yang dipilih)")
	translation.put("change-pencil-size-to", "Ubah ukuran pensil / penghapus menjadi %s")
	translation.put("clear-canvas", "Bersihkan kanvas")
	translation.put("undo", "Batalkan perubahan terakhir yang Anda buat (Tidak berfungsi setelah \""+translation.Get("clear-canvas")+"\")")

	translation.put("connection-lost", "Koneksi terputus!")
	translation.put("connection-lost-text", "Mencoba menyambungkan kembali"+
		" ...\n\nPastikan koneksi internet Anda berfungsi.\nJika "+
		"masalah terus berlanjut, hubungi webmaster.")
	translation.put("error-connecting", "Kesalahan saat menghubungkan ke server")
	translation.put("error-connecting-text",
		"Scribble.rs tidak dapat membuat koneksi socket.\n\nMeskipun koneksi internet "+
			"Anda tampaknya berfungsi, server atau firewall Anda mungkin belum "+
			"dikonfigurasi dengan benar.\n\nUntuk mencoba lagi, muat ulang halaman.")
	translation.put("message-too-long", "Pesan Anda terlalu panjang.")
	translation.put("server-shutting-down-title", "Server akan dimatikan")
	translation.put("server-shutting-down-text", "Maaf, tetapi server akan segera dimatikan. Silakan kembali lagi nanti.")

	// Help dialog
	translation.put("controls", "Kontrol")
	translation.put("pencil", "Pensil")
	translation.put("eraser", "Penghapus")
	translation.put("fill-bucket", "Ember isian")
	translation.put("switch-pencil-sizes", "Ukuran alat")
	translation.put("undo-help-message", "Batalkan")

	// Generic words
	// "close" as in "closing the window"
	translation.put("close", "Tutup")
	translation.put("no", "Tidak")
	translation.put("yes", "Ya")
	translation.put("system", "Sistem")
	translation.put("confirm", "Oke")
	translation.put("ready", "Siap")
	translation.put("join", "Gabung")
	translation.put("ongoing", "Sedang berlangsung")
	translation.put("game-over-lobby", "Permainan Selesai")

	translation.put("source-code", "Kode Sumber")
	translation.put("help", "Bantuan")
	translation.put("submit-feedback", "Masukan")
	translation.put("stats", "Status")

	translation.put("forbidden", "Dilarang")

	RegisterTranslation("id", translation)
}
