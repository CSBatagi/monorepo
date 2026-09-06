export const chapters = [
  { id: 'kulup', label: 'Kulüp', code: 'ÖNCE YOKLAMA', title: 'Bir oyundan fazlası.' },
  { id: 'rekabet', label: 'Rekabet', code: 'DOSTLUK MOLASI', title: 'Rekabetin içine gir.' },
  { id: 'mac-merkezi', label: 'Maç merkezi', code: 'BAHANE ARŞİVİ', title: 'Her raundun bir hikâyesi var.' },
  { id: 'istatistik', label: 'İstatistik', code: 'RAKAMLAR KONUŞSUN', title: 'İzini bırak.' },
] as const;

// Interpolated camera keyframes shared by the artwork and projected particle field.
export const cameraFrames = [
  { x: 0, y: 0, scale: 1.04, roll: 0, yaw: 0 },
  { x: -9, y: 4, scale: 1.3, roll: -3, yaw: .36 },
  { x: 8, y: -5, scale: 1.16, roll: 2.5, yaw: -.3 },
  { x: -4, y: -9, scale: 1.42, roll: -1, yaw: .18 },
];
