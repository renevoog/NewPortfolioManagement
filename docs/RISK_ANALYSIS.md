# BTC ja ETH tururisk

## Olemasolev arhitektuur ja teostus

Projekt jäi olemasolevale Expressi/CommonJS-i, EJS-i, Mongoose/MongoDB ja vanilla JavaScripti lahendusele. Kujundus kasutab olemasolevaid Bootstrap 5 / Exo / navy värve ning juba laaditavat Chart.js 4.4.7 teeki. Uusi npm sõltuvusi ega frontend-raamistikku ei lisatud.

Olemasolevad `/home`, `/watchlist` ja `/sharpe`, Yahoo ja eToro teenused ning kasutaja-, jälgitavate varade ja lemmikute mudelid jäävad samaks. Uus **Tururisk** tab avab `/risk`; autentitud `/api/risk-data?asset=BTC|ETH` tagastab serveri vahemälu. Autentimine kasutab olemasolevat Passporti ja `ensureAuthenticated` kontrolli. Värske hind tuleb olemasolevast `watchlistQuoteService` → `yahooFinanceClient` ühendusest. Uus moodul ei muuda portfelli, tehinguid, kasutajaid ega lemmikuid.

| Vastutus | Failid |
| --- | --- |
| Navigeerimine, autentitud vaade/API | `views/partials/header.ejs`, `server/routes/router.js`, `server/controller/riskController.js` |
| EJS, vanilla DOM, Chart.js, mobiilivaade | `views/risk.ejs`, `public/js/risk.js`, `public/css/risk.css`, kitsas navbar'i muudatus `public/css/dashboard.css` |
| Puhas arvutusmootor | `server/services/risk/technicalRisk.js` |
| Avalike andmete adapterid ja retry | `server/services/risk/riskProviders.js` |
| Perioodiline kogumine, andmete olek, vahemälu | `server/services/risk/riskService.js`, käivitus `server.js` |
| Mongo mudelid, muutumatud versioonid/snapshot'id | `server/model/models.js`, `server/services/risk/riskStore.js` |
| Testid ja pärisandmete kontroll | `test/technicalRisk.test.js`, `test/riskProviders.test.js`, `test/riskService.test.js`, `scripts/check-risk-data.js` |
| Käivitussätted ja käsud | `config.env.example`, `fly.toml`, `package.json`; kohalik ignoreeritud `config.env` sai kasutusviisi deklaratsiooni |

## Arvutus: `technical-risk-1.0.0`

Sisend on iga vara eraldi USD päevaseeria. Kuupäev D tähistab UTC päeva D sulgemishinda, mis on kasutatav alles D+1 kell 00:00 UTC. Tänast lõpetamata päeva ei kasutata. Sorteerimine toimub UTC järgi; korduv kuupäev või vale vara lükatakse tagasi, puuduvaid hindasid ei interpoleerita.

- **Trend:** `ln(price / SMA730)`. SMA vajab 730 järjestikust kehtiva hinnaga kalendripäeva; lünk nullib akna.
- **Momentum:** Wilderi RSI14 tegelikest pühapäevastest sulgemishindadest. Esialgsed keskmised vajavad 14 nädalamuutust; edasi `avg = (13 × previousAvg + currentChange) / 14`. RSI = `100 − 100 / (1 + avgGain / avgLoss)`. Täiesti lame hind annab RSI 50, ainult tõusud 100. Lõpetamata nädalat ei kasutata. Puuduv pühapäev katkestab nädalase ahela.
- **SMA200w:** viimase 200 järjestikuse kehtiva nädalalõpu keskmine, ainult võrdlusnäitaja.
- **MVRV:** `marketCap / realizedCap`, üksnes sama päeva tegelikest algandmetest.
- **MVRV Z:** `(marketCap − realizedCap) / populationStdDev(marketCap[algus…D])`. Standardhälve on populatsiooni standardhälve ning hõlmab ainult seni vaadeldud päevi. Nullhajuvus või puuduvad kapitalisatsioonid annavad puuduva väärtuse. Skoori väärtustamiskomponent on **MVRV suhtarvu** protsentiil; Z on täiendav näit, seda ei kaaluta teist korda.

Normaliseerimine on laieneva varasema jaotuse keskastme protsentiil:

`100 × (varasemaid väiksemaid + 0.5 × varasemaid võrdseid) / varasemate vaatluste arv`.

Jooksev vaatlus ei kuulu enda võrdlusjaotusse. Trendi ja MVRV jaoks on vaja vähemalt **365 varasemat kehtivat päevakomponenti**, RSI jaoks **52 varasemat kehtivat nädalakomponenti**. RSI protsentiili ei loeta igal nädalapäeval uuesti üheks sõltumatuks vaatluseks. Esimese skoori pikk ooteaeg on teadlik; ajaloo alguse skoorid jäävad tühjaks.

Täismudeli kaalud on trend **40%**, momentum **25%**, MVRV **35%**. Kui MVRV puudub või ei ole normaliseerimiseks piisavalt ajalugu, on eraldi **Price-only Technical Risk** kaaludega **40/65 = 61,538…%** ja **25/65 = 38,461…%**. Kui trend või RSI puudub, skoori ei ole. API tagastab `fullScore` ja `priceOnlyScore` eraldi; graafik ei ühenda eri mudeleid üheks varjatud segaseeriaks. Iga punkt sisaldab toorväärtusi, protsentiile, valimimahte, komponentide vaatluskuupäevi, kaale ja tundlikkust.

Kaalud on kontrollitavad hüpoteesid. Täismudeli alternatiivid on 50/20/30, 35/35/30 ja 35/20/45; hinnamudeli alternatiivid on 50/50 ja 75/25. API/vaade näitavad viimase päeva vahemikku ning kogu ajaloo suurimat ja keskmist maksimaalset erinevust. Ühtegi kaalu ei valitud turutipuga sobitamise ega tootluse maksimeerimise järgi. See on tundlikkusanalüüs, mitte prognoositäpsuse tõestus.

## Allikad ja CBBI

Üksikasjalik allikate, litsentside, üheksa indikaatori, originaali lähtekoodi/testide ja BTC/ETH metoodika audit on [RISK_DATA_SOURCES.md](RISK_DATA_SOURCES.md).

- **Coin Metrics Community:** BTC ja ETH `PriceUSD`, `CapMrktCurUSD`. Kontrollitud isiklik mitteäriline kasutus, CC BY-NC 4.0; allika ja litsentsi viited on vaates. Tasuta API ei võimaldanud `CapRealUSD` mõõdikut kummagi vara jaoks (403). Seetõttu töötab praegu hinnapõhine mudel, MVRV ja Z jäävad puuduva väärtusena nähtavaks.
- **Yahoo Finance:** hetkehinnaks rakenduse olemasolev BTC-USD / ETH-USD integratsioon ja vahemälu. Kui hinnapäring ebaõnnestub, säilib vana ajatempliga hind; esimese laadimise korral kasutatakse selgelt märgitud Coin Metricsi viimast päevahinda. Värske quote ei sisene päevase riskiskoori arvutusse.
- **CBBI ametlik JSON:** `Confidence` ja üheksa ilma `2` lõpuliiteta komponenti. Skaala teisendatakse 0–1 → 0–100. BTC esmane skoor on alati avaldatud CBBI. ETH-l CBBI-d ei kuvata. CBBI ja Technical Risk ei moodusta uut koondindeksit.

**Kõik üheksa avaldatud CBBI komponenti on viimases kontrollitud reas olemas. Algindikaatoreid siin kohapeal ei arvutata.** AGPL koodi ei kopeeritud ega tõlgitud; algne projekt vajaks lisaks Pythoni keskkonda ja väliste toorallikate õigusi. Ametlik API on avalikult kasutamiseks viidatud, kuid eraldi piiramatu ärilise edasilevitamise litsentsi ei tuvastatud. Isikliku kasutuse kinnitus ei anna automaatselt õigust tulevaseks tasuliseks taaspublitseerimiseks.

Avaldatud `Confidence` ja üheksa täieliku komponendi keskmist võrreldakse tolerantsiga **0,011 punkti**. Kontroll ei asenda ametlikku skoori ega väida CBBI sõltumatut ümberarvutust. Puuduliku rea keskmist ei arvutata. Puuduv uusima päeva ametlik `Confidence` põhjustab värskenduse vea; vanem skoor säilib kuupäeva ja aegumise märgistusega.

## Andmete säilitamine ja töörežiim

Uued jagatud kogumid on `riskdatasets`, `risksources`, `risksnapshots`.

- `riskdatasets`: gzip-pakitud sisend või arvutustulemus, SHA-256 sisuversioon, allika/vara võti ja kuupäev. Ainult `$setOnInsert`, unikaalne `(key,version)`. Mudeli versioon ja sisendversioon on arvutustulemuse võtmes. Varasemate versioonide sisu ei kirjutata üle.
- `risksources`: viide viimasele õnnestunud andmeversioonile, pärisandmete lõppkuupäev, allalaadimise aeg, järgmine katse, viga ja protsessidevaheline 15 minuti kogumislukk. Yahoo quote on väike muutuv kirje. Indeksid luuakse enne kogumist.
- `risksnapshots`: BTC CBBI esimene tegelik vaatlus eelmise lõpetatud UTC päeva kohta, vaatlusaja ja sisendversiooniga. Unikaalne `(asset,methodology,date)` ja `$setOnInsert`. Mineviku täisajalugu ei muudeta tagantjärele tollal nähtud snapshot'ideks. Ümberkalibreeritud ajalugu ja snapshot'id on UI-s eraldi valitavad.

Koguja käivitub pärast MongoDB ühendust. Iga minuti järel kontrollib ta tähtaegu: Coin Metrics ja CBBI **6 tunni** järel, Yahoo quote **5 minuti** järel. Coin Metricsi alglaadimine toob kogu ajaloo; tavaline uuendus kordab viimast seitset päeva ja **kord nädalas** loeb kogu ajaloo uuesti, et allika parandused saaksid uue versiooni. CBBI voog sisaldab tervet ümberkalibreeritud ajalugu ja loetakse seetõttu tervikuna.

Lehe avamine ega „Uuenda vaadet” ei käivita väliseid ajaloopäringuid. Vaade loeb andmeid minutise intervalliga; pärisandmete kogumist koordineerivad taustatöö ja Mongo lukud. Ebaõnnestumine säilitab viimase õnnestunud väärtuse/ajatempli ning näitab aegumist. Päevane allikas loetakse aegunuks üle 48 tunni pärast viimase andmepäeva lõppu, quote üle 15 minuti pärast hinnavaatlust; värskenduse viga märgitakse kohe.

API pakib täieliku ajaloo vastuse gzip'iga, kui klient seda toetab, ning märgib `Vary: Accept-Encoding` ja `Cache-Control: no-store`. Serveri vahemälu on andme- ja mudeliversiooni põhine; brauser ei jaga autentitud vastust avaliku cache'iga.

Uute Coin Metricsi ja CBBI adapterite HTTP timeout on 20 sekundit. Transientse ühendusvea, 429 või 5xx korral on kuni kolm katset, ooted 1 ja 2 sekundit või pikem `Retry-After`. Üle 30 sekundi serverioote korral uus katse lükatakse taustatööle, seda ei kärbita. Coin Metricsi 429 peatab mõlema vara päringud ja säilitab ooteaja ka protsessi taaskäivitamisel; MVRV ligipääsu viga ei kaota juba saadud hinnaseeriat. Yahoo kasutab olemasolevat 15-sekundilise timeout'i ja minutise jagatud vahemäluga teenust; selle ebaõnnestunud riskimooduli uuendust proovitakse 15 minuti pärast uuesti.

Sisendite hilisemad parandused võivad muuta uue andmeversiooni minevikuskoore. Matemaatiline tulevikuandmeteta arvutus **ei tõenda allika ajaloolist avaldamisaega ega algse versiooni kättesaadavust**. Sama sisendversiooni ja mudeliversiooniga tulemus on korratav. Salvestatud andmeversioonidele ei rakendata automaatset kustutamist: kettamahu kasvu tuleb jälgida.

## Seadistamine ja kontroll

Olemasolev `DATABASE_URI` ja autentimise sätted on endiselt vajalikud. `config.env.example` sisaldab uusi võtmeid:

```dotenv
RISK_DATA_USAGE=personal-noncommercial
COIN_METRICS_API_KEY=
RISK_REFRESH_ENABLED=true
```

Kasutaja kinnitatud mitteäriline kasutus on seadistatud ka kohalikus ignoreeritud `config.env` failis ja `fly.toml` keskkonnas. Ilma selle deklaratsiooni või litsentsitud Pro võtmeta Community andmeid ei koguta. Pro võtme korral pärib adapter `CapRealUSD` eraldi; täismudel aktiveerub ainult tegelike väärtuste ja piisava ajaloo korral. API võtit ei saadeta brauserisse. Ärirežiimi tuleb käsitleda eraldi litsentsi ja CBBI kasutusõiguste kontrollina.

```text
npm start
npm test
npm run risk:refresh   # toob vaid tähtajaks vajaliku; kontrollib salvestatud andmeid
npm run risk:check     # kontrollib andmeversioone, arvutusi ja snapshot'i päritolu
```

Selle Windowsi keskkonna usaldusahelaga töötas käivitus `node --use-system-ca server.js` ja kontroll `node --use-system-ca scripts/check-risk-data.js`. Tavaline Node käivitus sai Atlasest sertifikaadi kontrolli vea; TLS kontrolli ei lülitatud välja. Rakenduse Docker kasutab Node 20, kohalik kontroll kasutas Node 24.14.0; süsteemi CA valik on kohaliku Node versiooni käivitusvõimalus, mitte Dockerile lisatud nõue.

Praegune `fly.toml` lubab masina automaatset seiskamist (`min_machines_running=0`). Kui rakendus seisab, ei saa see päevaskoori jälgida. Katkematuks snapshot'ide kogumiseks peab vähemalt üks instants pidevalt töötama või välise ajastaja kaudu käivituma. Kohalik Fly konfiguratsioon sai ainult kasutusviisi keskkonnamuutuja; masina seiskumise sätteid ega väliseid teenuseid ei muudetud ja muudatusi ei avaldatud.

## Kontrollitud tulemus 2026-11-02

- `npm test`: **87 läbitud, 0 ebaõnnestunud**. Uus moodul: 70 testi; olemasolevad watchlisti testid: 17. Kaetud on SMA/RSI/MVRV, protsentiilid/kaalud, puuduvad ja vigased andmed, UTC päevad/nädalad, napp ajalugu, 429/backoff, varade lahusus, tulevaste punktide lisamise invariantsus, versioonide korratavus, cache, snapshot'id ja autentitud HTTP marsruudid.
- Päris impordi käigus salvestati MongoDB-sse BTC **5951** ja ETH **4104** hinnapäeva. Viimane päev on 2026-11-01. BTC Price-only skoor on ligikaudu **28,24**, ETH **38,83**; need on kontrollhetke andmeversiooni tulemused.
- CBBI: **5607** päeva, neist **5258** täieliku üheksa komponendiga, **349** varase puuduliku komplektiga. Viimane ametlik skoor **51,37**. Komponentide kontrolli suurim erinevus **0,00777778**, alla tolerantsi **0,011**.
- Esimene päriselt vaadeldud CBBI päevaskoor salvestati muutumatu snapshot'ina. Yahoo BTC ja ETH värsked USD hinnad saadi olemasoleva ühenduse kaudu.
- `node --use-system-ca scripts/check-risk-data.js` läbis päris MongoDB andmete kontrolli: mõlema vara sisendi SHA-256 vastas versioonile, salvestatud arvutus kattus uuesti arvutatuga ja snapshot vastas algsele CBBI versioonile.
- **11 brauserikontrolli läbisid** eraldi kohalikus eelvaates pärisandmetega: 1440 px desktop, 390/320 px mobiil ilma lehe horisontaalse ülevooluta, üheksa komponenti, varavahetus, eraldi mudeliseeriad, perioodid/suum, tooltip'id, snapshot'id, aegumine ja API tõrge. JavaScripti käitusvigu ei esinenud. Eelvaade kasutas eraldi kohalikku kasutajanime; tootmise sessiooni ega konto andmeid ei muudetud. Autentimise käitumist kontrollis HTTP automaattest.
- Tasulise Coin Metricsi Pro võtmega andmevoogu ei saanud ilma võtmeta elavalt kontrollida; adapteri ligipääsu- ja andmelünkade käitumine on automaattestitud. CBBI originaali Python-teste ei käivitatud, sest selle arvutuskoodi ei integreeritud.
