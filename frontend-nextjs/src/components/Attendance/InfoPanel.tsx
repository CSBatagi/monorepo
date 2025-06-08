import React from 'react';

const InfoPanel = () => {
  return (
    <div className="bg-white p-4 rounded-lg shadow-md">
      <h3 className="text-xl font-semibold mb-3">Program & Bilgi</h3>
      <p className="text-sm"><strong>Katılım bildirme deadline:</strong> 21:00</p>
      <p className="text-sm"><strong>Takım alışma:</strong> 21:15 - 21:45</p>
      <p className="text-sm"><strong>Online olma saati:</strong> 21:45</p>
      <p className="text-sm"><strong>Maç Başlangıcı:</strong> 22:00</p>
      <hr className="border-gray-200 my-3" />
      <h4 className="text-lg font-semibold mb-2 text-blue-600">Drafting nasıl oluyor</h4>
      <ul className="list-disc list-inside text-sm space-y-1 text-gray-600">
        <li>Yazı turayı KAZANAN "ilk adamı mı alacağım yoksa ilk adamı karşıya bırakıp peşi sıra 2 adam mı alacağım" sorusuna cevap veriyor</li>
        <li>Yukarıdaki soruya cevap verildikten sonra 1 - 2 - 2 - 2 - 2 -....- 1 şeklinde adam alınıyor</li>
        <li>"Takımlar dengesiz oldu yaaaaa" gibi bir durum oluştuysa son ayarlar çekiliyor</li>
        <li>Yazı turayı KAZANAMAYAN birinci ve üçüncü haritayı seçiyor</li>
        <li>Yazı turayı KAZANAN ikinci haritayı seçiyor</li>
        <li>Yazı turayı KAZANAN 1 ve 3 nolu haritalarda hangi taraf olarak başlayacağını seçiyor</li>
        <li>Yazı turayı KAYBEDEN 2. haritada hangi taraf olarak başlayacağını seçiyor</li>
      </ul>
    </div>
  );
};

export default InfoPanel; 