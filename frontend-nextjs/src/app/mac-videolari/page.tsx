export default function MacVideolariPage() {
  const playlistUrl = 'https://www.youtube.com/playlist?list=PLL0VhWmE7Ol4ZDkxDp837vA0Y0_QF3_KT';

  return (
    <div id="page-mac-videolari" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Maç Videoları</h2>
      <div className="w-full">
        <iframe
          className="w-full aspect-video rounded-lg shadow-lg"
          style={{ border: '1px solid rgba(0, 0, 0, 0.1)' }}
          src="https://www.youtube.com/embed/videoseries?si=LMIPvbLjHwNAbtJS&list=PLL0VhWmE7Ol4ZDkxDp837vA0Y0_QF3_KT"
          title="Maç Videoları"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          loading="lazy"
        />
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-600">
          Maç videoları playlistini YouTube'de açmak için linke tıklayın.
        </p>
        <a
          href={playlistUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 transition-colors"
        >
          Playlist'i YouTube'da Aç
        </a>
      </div>
    </div>
  );
}
