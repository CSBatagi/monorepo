export default function MacVideolariPage() {
  return (
    <div id="page-mac-videolari" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Maç Videoları</h2>
      <div className="w-full">
        <iframe
          className="w-full aspect-video"
          style={{ border: '1px solid rgba(0, 0, 0, 0.1)' }}
          src="https://www.youtube.com/embed/videoseries?si=LMIPvbLjHwNAbtJS&list=PLL0VhWmE7Ol4ZDkxDp837vA0Y0_QF3_KT"
          title="Maç Videoları"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          loading="lazy"
        />
      </div>
    </div>
  );
}
