# Riskianalüüsi andmeallikate kontroll

Kontrollitud 2026-11-02. See fail kirjeldab allikaid ja integratsiooni eeldusi; rakenduse testitulemused ning käivitamise juhised on riskimooduli tehnilises dokumentatsioonis. Kasutaja kinnitas isiklikku mitteärilist kasutust.

## Coin Metrics

Kasutatav päevase ajaloo liides on `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics`. Parameetrid: `assets=btc` või `assets=eth`, `metrics=PriceUSD,CapMrktCurUSD`, `frequency=1d`, `start_time`, `end_time`, `page_size=10000`. Vastuse `data` sisaldab `{ asset, time, PriceUSD, CapMrktCurUSD }`; arvud on tekstina. Lehekülgi ühendab `next_page_url`. Vara identiteeti tuleb igal real kontrollida.

Elav kontroll tagastas BTC jaoks 5951 hinnavaatlust alates 2010-07-18 ning ETH jaoks 4104 alates 2015-08-08; mõlema viimane päev oli 2026-11-01. Võtmeta `CapRealUSD` päring tagastas **mõlema vara puhul HTTP 403**. Seetõttu ei tõenda tasuta API kättesaadavus MVRV algandmete kättesaadavust. Tasuline API `https://api.coinmetrics.io/v4` eeldab sobiva ulatusega võtit ja lepingut; võtme olemasolu üksi ei taga õigust sellele mõõdikule.

Community andmete litsents on [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), nagu kinnitavad [Coin Metricsi Community tingimused](https://docs.coinmetrics.io/packages/coin-metrics-community-data) ja [ametliku andmearhiivi README](https://github.com/coinmetrics/data#license). Rakendus peab säilitama autoriviite ja litsendilingi ning märkima oma arvutused tuletatud analüüsiks. `RISK_DATA_USAGE=personal-noncommercial` tähistab kasutaja kinnitatud kasutusviisi; ärikasutus vajab eraldi sobivat lepingut ja Pro API ligipääsu. Community piirang on 10 päringut kuue sekundi jooksul IP kohta; 429 korral tuleb austada serveri ooteaega. [API viide](https://docs.coinmetrics.io/api/v4/)

### Päevapiir ja on-chain definitsioonid

`PriceUSD` tähistab märgitud UTC päeva **sulgemishinda**, kuigi API `time` on selle päeva `00:00:00Z`. Näiteks 2026-11-01 rida on kasutatav alles päeva lõppedes 2026-11-02 kell 00:00 UTC, mitte eelmisel hommikul. See ei ole reaalajas hetkehind. Nädala sulgemishind tuleb võtta lõppenud UTC nädala viimasest päevast. [Hinna definitsioon](https://docs.coinmetrics.io/network-data/network-data-overview/market/price)

`CapMrktCurUSD = SplyCur × PriceUSD`. `CapRealUSD` kaalub hetke native-vara ühikuid hinnaga nende viimase on-chain liikumise päeval. BTC puhul määrab vanuse UTXO loomine; kontopõhise ETH puhul konto loomine või viimane väljuv saldo muutus, kumb on hilisem. ERC-20 vara ei kuulu ETH native-kapitalisatsiooni. Seega ei ole BTC ja ETH realiseeritud väärtuse majanduslik tõlgendus identne. [Kapitalisatsiooni definitsioonid](https://docs.coinmetrics.io/network-data/network-data-overview/market/market-capitalization)

Võimaliku lubatud algandmestiku korral on `MVRV = CapMrktCurUSD / CapRealUSD` ning `MVRV Z = (CapMrktCurUSD − CapRealUSD) / σ(CapMrktCurUSD)`. Riskimudelis peab standardhälve kasutama üksnes sama päeva ja varasemaid vaatlusi; valimi algus ja standardhälbe variant tuleb versioonida. Null, nulline nimetaja, puuduv ajalugu ega puuduv õigus ei õigusta sünteetilist MVRV-d. ETH kontoaktiivsus, staking ning protokolli- ja pakkumise muutused piiravad võrreldavust. Täna laaditud ajaloo suhtes tehtud arvutus ei tõenda, et allikas avaldas täpselt need väärtused ajaloolisel kuupäeval.

## CBBI avaldatud andmed

[Ametlik CBBI veebileht](https://colintalkscrypto.com/cbbi/) pakub lingiga „Access free API” aadressi `https://colintalkscrypto.com/cbbi/data/latest.json`. Selle avaliku voo tarbimine on eraldi AGPL lähtekoodi kopeerimisest. README, FAQ ja projektilinkide kontroll ei leidnud eraldi andmelitsentsi, mis annaks piiranguteta ärilise edasilevitamise õiguse. Kasutus siin lähtub avalikult pakutud API-st ja kinnitatud isiklikust mitteärilisest kasutusest; see ei kinnita edasimüügi ega ärilise taaspublitseerimise õigust. Säilitada tuleb CBBI autoriviide ja allikalink. Voo teenustaset ega eraldi päringulimiiti ei ole dokumenteeritud.

JSON on veergudena: `Price`, `Confidence` ning allolevad üheksa võtit. Iga veerg seob Unix-aja sekundites väärtusega või `null`-iga. `Confidence` ja komponendid on skaalal 0–1, mida kuvatakse skaalal 0–100. **Komponendid on CBBI normaliseeritud panused, mitte indikaatorite toorväärtused.**

| JSON-võti | Indikaator | Uuritud originaali sisend ja sõltuvus |
| --- | --- | --- |
| `PiCycle` | Pi Cycle Top | 111 päeva SMA ja 2 × 350 päeva SMA; hinnast arvutatav |
| `RUPL` | RUPL/NUPL | Väline Coinanki on-chain seeria |
| `RHODL` | RHODL Ratio | Väline Coinanki seeria, seejärel logaritmiline teisendus |
| `Puell` | Puell Multiple | Päevane USD emissioon / selle 365 päeva keskmine; Coin Metrics |
| `2YMA` | 2-Year Moving Average | Hind ja 730 päeva SMA |
| `Trolololo` | Trolololo Trend Line | Hinna ja ajapõhiste trendikõverate võrdlus |
| `MVRV` | MVRV Z-Score | Väline Coinanki Z-score, originaali eraldi teisendustega |
| `ReserveRisk` | Reserve Risk | Väline Coinanki seeria |
| `Woobull` | Top Cap vs CVDD | Woochartsi mudelid ja hind |

Lähteandmed ei ole kogu algoritm: originaal kalibreerib indikaatoreid tsüklite äärmuste ja regressioonide abil. Välistest toorandmetest sõltuvad osad vajaksid eraldi allikaõiguste kontrolli. Siin ei kopeerita neid arvutusi ega kasutata Coinanki või Woochartsi toorliideseid rakenduse andmeallikana. [Uuritud indikaatorite lähtekood](https://github.com/Zaczero/CBBI/tree/31e4b869d1ecd425040885b820cb75e39a879299/metrics)

Voos on ka `Confidence2` ja üheksa `*2` veergu. Ametliku veebilehe režiimivalik eristab neid regressiooniga CBBI-st kui vähenevate tootluste/kahjumite korrigeerimiseta varianti. Integratsioon kasutab **`Confidence` ja ilma `2` lõpuliiteta komponente**; neid režiime ei segata.

### Kontrollitud vastavus ja ajaloo piirangud

2026-11-02 kontrollis oli 5607 kuupäeva ajavahemikus 2011-06-27 kuni 2026-11-01. Kõik üheksa komponenti olid olemas 5258 päeval; 349 varasel päeval oli vähemalt üks puudu. Täielike ridade komponentide aritmeetilise keskmise suurim erinevus avaldatud `Confidence` väärtusest oli **0,00777778 punkti skaalal 0–100**. See sobib voo neljakohalisest ümardamisest tuleneva erinevusega; kontrolltolerants on 0,011 punkti. Viimane avaldatud tulemus oli 51,37.

See on avaldatud komponentide **kooskõlakontroll**, mitte sõltumatu üheksa indikaatori taasarvutus. Puuduva komponendi korral kontrollkeskmist ei tehta. Ametlikku avaldatud `Confidence` väärtust võib sellisel ajal näidata koos komponentide puudulikkusega; puuduvate väärtuste keskmist ei tohi ise CBBI-ks nimetada.

[CBBI FAQ](https://colintalkscrypto.com/cbbi/faq.html) ütleb, et voogu värskendatakse kaks korda päevas ning tsüklijärgne ümberkalibreerimine muudab ka ajalugu. Seetõttu on laaditud täisajalugu **tänase kalibratsiooni ajalugu**. Esimest korda päriselt nähtud päevaskoori snapshot peab säilitama vaatlusaja, allika päeva ja versiooni muutumatult. Vanu ridu täna esimest korda laadides ei tohi neid nimetada tol ajal avaldatud snapshot'ideks.

## Lähtekood, litsents ja käituskeskkond

Uuritud [Zaczero/CBBI](https://github.com/Zaczero/CBBI) commit on `31e4b869d1ecd425040885b820cb75e39a879299`: README, kõik üheksa indikaatorit, API-abifailid, põhikoondamine, andmete laadimine, litsents ja `tests/test_metrics.py`. Avalik JSON ei teata generaatori commit'i; uuritud SHA ei tõenda, et avalik voog on just selle revisjoniga arvutatud. Avalik veebileht viitab lisaks teisele CBBI lähtekoodihoidlale.

Originaal kasutab Python `~=3.14.0`, Polarsit, NumPyd, Matplotlibi ja teisi Python-pakette. Selle lokaalne käivitamine lisaks olemasolevale Node/Express/EJS/Mongoose rakendusele uue käituskeskkonna ja ei lahendaks andmeõigusi. Originaali testid keskenduvad Woochartsi viitele/puuduvatele andmetele ning fallback'i usaldusväärsusele; need ei tõenda kogu üheksa indikaatori sobivust investeerimisotsusteks. Originaali Pythoni teste siin ei käivitatud.

[AGPL-3.0 litsentsi](https://github.com/Zaczero/CBBI/blob/31e4b869d1ecd425040885b820cb75e39a879299/LICENSE) punkt 13 nõuab muudetud võrguprogrammi kasutajatele vastava lähtekoodi pakkumist; punkt 2 ei muuda arvulist väljundit automaatselt AGPL koodiks. See ei anna siiski kolmandate osapoolte andmetele uusi õigusi. Selles rakenduses kasutatakse iseseisvalt kirjutatud andmeadapterit, CBBI lähtekoodi ei kopeerita ega tõlgita JavaScripti. Oma Technical Risk on eraldi mudel; CBBI ja Technical Risk ei moodusta kolmandat koondindeksit.
