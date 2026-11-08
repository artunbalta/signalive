# Bill of Materials v0: reference parts

Reference parts per earbud, why each one, and what it costs, plus the dev kit that
reproduces the validation data set today. Requirements are in [SPEC.md](SPEC.md).

**About the prices.** Distributor prices were read on 2026-11-02 at the quantity shown,
mostly from Digi-Key US, in USD unless marked. They are 160 to 5,900 piece prices, not
production prices: anything at 10,000 pieces and up has to be quoted. "Estimate" means no
quote or listing was found and the number is a planning guess. TI's product pages, as
fetched that day, showed no 1,000 piece price for any TI part below.

## Per earbud, Nordic based reference design (Rev A to Rev B)

| Function | Reference part | Key figures (verified) | Why this part | Unit price |
|---|---|---|---|---|
| Biopotential AFE, earbud candidate | TI [AFE159RP4](https://www.ti.com/product/AFE159RP4) | 4 channels, 24 bit; 0.42 mW per channel; 4 µVpp in 150 Hz; CMRR -140 dB; 125 SPS to 128 kSPS; DSBGA-49, 3.7 x 3.6 mm; analog 3.15 to 5.25 V plus 1.7 to 1.9 V; TI names EEG as an application | Smallest and lowest power 4 channel biopotential AFE found; meets the SPEC HW-AFE-09 targets on headline figures. The public datasheet (Rev. A, Nov 2024) is a summary: request the full one | $31.48 at 250 ([Digi-Key](https://www.digikey.com/en/products/detail/texas-instruments/AFE159RP4YAFT/26639666)) |
| Biopotential AFE, documented alternative | TI [ADS1294R](https://www.ti.com/product/ADS1294R) | 4 channels, 24 bit; 4 µVpp (150 Hz, gain 6); 4.1 to 5.4 mW total at 3 V; CMRR -105 dB min; nFBGA-64, 8 x 8 mm; AVDD 2.7 to 5.25 V ([datasheet](https://www.ti.com/lit/ds/symlink/ads1294r.pdf)) | Full datasheet public, runs from 3 V, same family conventions as the ADS1299 on the dev kit. TI's [ADS1294](https://www.ti.com/product/ADS1294) page points to the AFE159RP4 as a newer version | $27.03 at 250 ([Digi-Key](https://www.digikey.com/en/products/detail/ADS1294RIZXGT/296-28271-1-ND/2601679)) |
| BLE SoC | Nordic [nRF5340](https://www.nordicsemi.com/Products/nRF5340) | Application core Cortex-M33 at 128 MHz, 1 MB flash, 512 KB RAM; network core Cortex-M33 at 64 MHz; LE Audio; TX 3.2 mA at 0 dBm, RX 2.6 mA; -40 to +3 dBm; I2S and PDM; aQFN94 7 x 7 mm or WLCSP95 4.4 x 4.0 mm ([key features](https://docs.nordicsemi.com/r/bundle/ps_nrf5340/page/keyfeatures_html5.html)) | Open SDK, LE Audio, a reference audio board (nRF5340 Audio DK), and Nordic's power profiler tooling | $6.09 at 800, reel ([Digi-Key](https://www.digikey.com/en/products/detail/nordic-semiconductor-asa/NRF5340-QKAA-R7/13559662)) |
| Audio DSP, codec, headphone driver | Cirrus Logic [CS47L63](https://www.cirrus.com/products/cs47l63/) | Halo Core DSP, 3 cores, 450 MIPS, 672 kB; 4 inputs; mono differential headphone driver; ADC 99 dB and DAC 108 dB dynamic range; 10 µA sleep; WLCSP, 61 balls, 0.4 mm pitch | Cirrus positions it for earbud headphones, and it is the audio DSP on Nordic's [nRF5340 Audio DK](https://www.nordicsemi.com/Products/Development-hardware/nRF5340-Audio-DK), so the steered path can be prototyped on a kit | Not published; $3 to $5 (estimate) |
| PMIC and charger | Nordic [nPM1100](https://www.nordicsemi.com/Products/nPM1100) or [nPM1300](https://www.nordicsemi.com/Products/nPM1300) | nPM1100: charge 20 to 400 mA, 150 mA buck (1.8, 2.1, 2.7 or 3.0 V), WLCSP 2 x 2 mm, the PMIC on the Audio DK. nPM1300: charge 32 to 800 mA, two 200 mA bucks, two LDO or load switches, fuel gauge, WLCSP 3.1 x 2.4 mm | Matches the SoC and the kit. Add a small boost or buck boost if the AFE159RP4 is used (it needs 3.15 V or more) | $1 to $2 (estimate) |
| IMU | ST [LSM6DSV16BX](https://estore.st.com/en/lsm6dsv16bxtr-cpn.html) | 0.95 mA, accelerometer plus gyroscope, high performance; ±2 to ±16 g; ±125 to ±4000 dps; embedded sensor fusion low power algorithm; Qvar; 3 axis audio accelerometer above 1 kHz for bone conduction; 2.5 x 3 x 0.71 mm | ST markets it for true wireless earbuds; on chip fusion may supply the quaternion SSP sends (to verify, SPEC HW-IMU-02) | $4.44 at 1,000 ([Digi-Key](https://www.digikey.com/en/products/detail/stmicroelectronics/LSM6DSV16BXTR/16841542)); launched at $3.95 at 1,000 ([audioXpress](https://audioxpress.com/news/stmicroelectronics-announces-all-in-one-motion-and-bone-conduction-sensor-for-hearables)) |
| IMU, alternatives | Bosch [BMI270](https://www.bosch-sensortec.com/en/products/motion-sensors/imus/bmi270/); ST [LSM6DSO](https://estore.st.com/en/lsm6dsotr-cpn.html) | BMI270: 685 µA at full rate; accelerometer 12.5 Hz to 1.6 kHz, gyroscope 25 Hz to 6.4 kHz; 160 µg/√Hz and 0.007 dps/√Hz; LGA-14, 2.5 x 3.0 x 0.8 mm. LSM6DSO: 0.55 mA high performance; 2.5 x 3 x 0.83 mm | Cheaper; the firmware then computes the quaternion | BMI270 $2.83 at 1,000 ([Digi-Key](https://www.digikey.com/en/products/detail/bosch-sensortec/BMI270/9974488)); LSM6DSO $3.05 at 1,000 ([Digi-Key](https://www.digikey.com/en/products/detail/stmicroelectronics/LSM6DSOTR/9605998)) |
| MEMS microphones, 2 required, third optional | Infineon IM72D128 | 71.5 dB SNR; -36 ± 1 dB sensitivity; 430 µA high performance, 160 µA low power; IP57; 4 x 3 x 1.2 mm ([Digi-Key](https://www.digikey.com/en/products/detail/infineon-technologies/IM72D128V01XTMA1/16730911), [release](https://www.electropages.com/2025/09/mems-microphone-lineup-delivers-best-class-audio-and-power-performance)) | Highest SNR found at under 0.5 mA, matched to ±1 dB (SPEC HW-MIC-02) | $1.39 at 1,000 (Digi-Key) |
| Microphones, alternatives | TDK [T5838](https://invensense.tdk.com/products/t5838/); Syntiant SPH18R1LM4H-1; Infineon IM69D130 | T5838: 68 dB SNR, 133 dB SPL overload, 330 µA and 130 µA modes, 3.5 x 2.65 x 0.98 mm. SPH18R1LM4H-1: 68.5 dB SNR, 129 dB SPL overload, 470 µA ([audioXpress](https://audioxpress.com/news/knowles-debuts-trio-of-sisonic-mems-microphones-for-high-performance-tws-and-hearable-designs)); Knowles sold this business to Syntiant ([audioXpress](https://audioxpress.com/news/knowles-completes-the-sale-of-its-consumer-mems-microphone-business-to-syntiant)). IM69D130: 4 x 3 x 1.3 mm, 1.3 mA in the Digi-Key listing; Infineon's [XENSIV overview](https://www.digikey.es/en/product-highlight/i/infineon/xensiv-acoustic-sensors) gives 69 dB(A) SNR, 130 dB SPL overload, 980 µA and 300 µA low power for what appears to be this part (to verify against its datasheet) | Second sources | T5838 to verify; SPH18R1LM4H-1 $1.03 at 5,900, on backorder ([Digi-Key](https://www.digikey.com/en/products/detail/syntiant/SPH18R1LM4H-1/17798558)); IM69D130 $1.21 at 1,000 ([Digi-Key](https://www.digikey.com/en/products/detail/infineon-technologies/IM69D130V01XTSA1/8030732)) |
| Battery | VARTA CoinPower CP1254 A4 | 74 mAh, 3.7 V, 12.1 x 5.4 mm ([Rapid](https://www.rapidonline.com/varta-88315101501-coinpower-button-cell-li-ion-3-7v-74mAh-rechargeable-08-0956)); the A3 version is 60 mAh, 1.6 g ([VARTA folder](https://www.aperza.com/catalog/page/10007767/25628/)) | The cell class earbuds use; the runtime estimate in SPEC section 8 rests on it. Second source: Grepow GRP1254, 68 to 96 mAh by variant, 12 x 5.4 mm, charging 0 to +45 °C ([Grepow](https://www.grepow.com/button-cell-battery/grp1254-g1-75mah.html)) | £11.91 at 1, excluding VAT (Rapid); $2 to $5 at volume (estimate) |
| Dry contacts, 6 per earbud | Ag/AgCl printed on the arc's flex circuit, as cEEGrids are printed, or Ag/AgCl coated conductive elastomer pads on it | See the materials table | SPEC HW-EEG-03, HW-MECH-07 | $1 to $3 per earbud (estimate) |
| Speaker | Balanced armature or 6 to 10 mm dynamic driver, chosen with the acoustic design | | | $1 to $3 (estimate) |
| Crystals (32 MHz, 32.768 kHz), antenna, passives, ESD parts | | Low leakage protection on the AFE inputs (SPEC HW-ENV-03) | | $1.50 to $3 (estimate) |
| Rigid flex board and assembly | | | | $4 to $8 (estimate) |
| Shell, arc (flex circuit, overmould), plain tips, charging contacts | | | SPEC HW-MECH-02, -07 | $3 to $6 (estimate) |

### Rough total

| | Low | High |
|---|---|---|
| Verified distributor prices: AFE, SoC, IMU, microphones | $38.01 (ADS1294R, BMI270, 2 x SPH18R1LM4H-1) | $46.18 (AFE159RP4, LSM6DSV16BX, 3 x IM72D128) |
| Estimated lines: DSP, PMIC, battery, contacts, speaker, passives, board, mechanics with the arc | $16.50 | $35.00 |
| **Per earbud** | **about $55** | **about $81** |
| Two earbuds | about $109 | about $162 |
| Charging case: cell, charger, MCU, enclosure (estimate) | $8 | $15 |
| **Per set, at prototype and low volume prices** | **about $117** | **about $177** |

The AFE is about 70% of the verified spend and 40 to 50% of the whole earbud, so it is the
cost lever: get a volume quote early, and keep footprints for a second source on Rev A until
the noise tests (SPEC T-01, T-07) settle the choice.

## Biopotential AFE: every candidate considered

| Part | Channels | Key figures (verified) | Verdict | Price |
|---|---|---|---|---|
| TI [ADS1299-4](https://www.ti.com/lit/ds/symlink/ads1299.pdf) | 4 | 1 µVpp (0.01 to 70 Hz, gain 24); 0.20 µVrms at 500 SPS, gain 24; CMRR -110 dB min; ±300 pA bias current; 22 mW at 5 V analog; TQFP-64, 10 x 10 mm body | Dev kit silicon; Rev A reference to compare noise like for like; too big and too hungry for the earbud | $40.81 at 160 ([Digi-Key](https://www.digikey.com/en/products/detail/texas-instruments/ADS1299-4PAG/6560945)) |
| TI ADS1299 (8 ch), ADS1299-6 | 8, 6 | Same datasheet; 39 mW and 30 mW typ | Dev kit only (the Cyton uses the ADS1299) | ADS1299 $79.89 at 25 ([Digi-Key](https://www.digikey.com/en/products/detail/texas-instruments/ADS1299IPAG/3675170)); ADS1299-6 $56.35 at 160 ([Digi-Key](https://www.digikey.com/en/products/detail/texas-instruments/ADS1299-6PAG/6559368)) |
| TI [ADS1294R](https://www.ti.com/lit/ds/symlink/ads1294r.pdf) | 4 | See above | Earbud alternative | $27.03 at 250 |
| TI [AFE159RP4](https://www.ti.com/product/AFE159RP4) | 4 | See above | Earbud candidate | $31.48 at 250 |
| TI [ADS1292R](https://www.ti.com/lit/ds/symlink/ads1292r.pdf) | 2 | 8 µVpp (150 Hz, gain 6); 335 µW per channel; CMRR 105 dB min; 125 SPS to 8 kSPS; VQFN-32, 4 x 4 mm | Two parts per earbud; noisier; fallback only | $11.38 at 750 ([Digi-Key](https://www.digikey.com/en/products/detail/texas-instruments/ADS1292RIRSMT/3674273)) |
| TI [ADS1293](https://www.ti.com/lit/ds/symlink/ads1293.pdf) | 3 | 7 µVpp (0.1 to 40 Hz), 15 µVpp (0.1 to 215 Hz); 0.3 mW per channel; ±400 mV input; WQFN-28, 5 x 5 mm | Too noisy for HW-AFE-02 and one channel short | $13.65 at 1,000 ([Digi-Key](https://www.digikey.com/product-detail/en/texas-instruments/ADS1293CISQ-NOPB/296-39852-1-ND/5177729)) |
| TI [AFE4960](https://www.ti.com/product/AFE4960) | 2 (ECG) | 222 µA per channel; 13 µVpp at gain 3, 5 µVpp at gain 12 (0.5 to 150 Hz); over 1 GΩ input; DSBGA, 2.6 x 2.6 mm; 1.7 to 1.9 V | Tiny, but two channels | $16.08 at 500 ([Digi-Key](https://www.digikey.com/en/products/detail/texas-instruments/AFE4960YBGT/18158609)) |
| ams OSRAM [AS7058](https://ams-osram.com/products/sensor-solutions/analog-frontend/ams-as7058-high-performance-vital-sign-analog-frontend) | 1 (ECG) | ±300 mV DC offset tolerance; 0.66 mA at 1.8 V and 400 Hz; WLCSP-42, 2.82 x 2.55 mm; hearables listed ([datasheet](https://look.ams-osram.com/m/6b2e246fe55145c1/original/AS7058-IC-for-PPG-ECG-and-body-impedance-measurement.pdf)) | Single channel | Not published |
| ST [ST1VAFE3BX](https://estore.st.com/en/st1vafe3bxtr-cpn.html), [ST1VAFE6AX](https://estore.st.com/en/st1vafe6axtr-cpn.html) | 1 | 3BX: single vAFE channel, 12 bit, up to 3200 Hz, 48.1 µA, LGA-12, 2 x 2 mm. 6AX: one vAFE channel plus a 6 axis IMU, fixed 240 Hz output, 2.5 x 3 mm | Single channel; noise not published. Worth a look for an always on, low power clench channel | 3BX $2.09 at 500; 6AX $4.77 at 500 (ST eStore) |
| Intan [RHD2216](https://intantech.com/files/Intan_RHD2000_series_datasheet.pdf) | 16 | 2.4 µVrms; CMRR 82 dB; AC coupled, ±0.4 V DC offset allowed; QFN-56, 8 x 8 mm | Built for electrophysiology research; noise and price wrong for this product | $166 at 250 and up ([Intan](https://intantech.com/pricing.html?tabSelect=RHDChips)) |
| Microchip [MCP3912](https://ww1.microchip.com/downloads/en/DeviceDoc/MCP3912-3V-Four-Channel-Analog-Front-End-DS20005348C.pdf) | 4 | Metering AFE in the OpenBCI Ganglion; input impedance falls to 33 kΩ at gain 32 | Unusable behind dry contacts without buffers | Not checked |
| TI [ADS131M04](https://www.ti.com/lit/ds/symlink/ads131m04.pdf) | 4 | Metering ADC; 3.3 mW; 0.2 µA input current at gain 8 and up | Input current far too high for megaohm contacts | Not checked |

## BLE SoC and audio platform

| Part | Key figures (verified) | Verdict | Price |
|---|---|---|---|
| Nordic nRF5340 | See the main table | Rev A and Rev B radio; prototype audio with the CS47L63 | $6.09 at 800 |
| Nordic [nRF54L15](https://www.nordicsemi.com/Products/nRF54L15) | Cortex-M33 at 128 MHz plus a RISC-V coprocessor; 1.5 MB NVM, 256 KB RAM; Bluetooth 6.0 Channel Sounding; RX 3.4 mA, TX 4.8 mA at 0 dBm (3 V); up to +8 dBm; I2S and PDM; CSP47, 2.4 x 2.2 mm; in mass production ([datasheet](https://docs.nordicsemi.com/r/bundle/ps_nrf54l15/page/keyfeatures_html5.html)) | Cheaper sensor radio if the audio moves to a separate audio SoC; its product page does not list LE Audio | $2.29 at 1,500, reel ([Digi-Key](https://www.digikey.com/en/products/detail/nordic-semiconductor-asa/NRF54L15-CAAA-R7/24773447)) |
| Nordic [nRF54H20](https://www.nordicsemi.com/Products/nRF54H20) | Cortex-M33 cores up to 320 MHz plus RISC-V coprocessors; 2 MB NVM, 1 MB RAM; RX 1.7 mA; up to 10 dBm; WLCSP 4.7 x 4.3 mm | Still restricted sampling through Nordic sales ([DevZone](https://devzone.nordicsemi.com/f/nordic-q-a/125860/subject-inquiry-about-availability-and-support-status-of-nrf54h20-mcu)); not for now | No distributor listing |
| Qualcomm S3 and S5 Gen 3 (QCC3083, QCC3084, QCC3095) | LE Audio and Auracast, Bluetooth 5.4, programmed through Qualcomm's audio development kit, third party code through the Voice and Music Extension Program ([audioXpress](https://audioxpress.com/news/new-qualcomm-s3-gen-3-and-qualcomm-s5-gen-3-sound-platforms-dramatically-expand-options-for-mid-tier-designs)) | Dual mode, mass market TWS silicon. Access: a company must register and be approved by Qualcomm before seeing documents, and NDAs are arranged with Qualcomm ([Digi-Key forum](https://forum.digikey.com/t/qualcomm-development-kits-adk-and-transaction-bridge-dk-qcc5124/22000), [2026 thread](https://forum.digikey.com/t/qcc5181-development-kit-and-adk-access-inquiry/68406)) | Bluetooth developer license $3,696 ([Digi-Key](https://www.digikey.com/en/products/detail/qualcomm/DL-BDEV-10002-1A/2123162)); QCC5171 dev kit $985.60 each, box of 3, 10 week lead time ([Digi-Key](https://www.digikey.com/en/products/detail/qualcomm/DK-QCC5171-WLCSP99-A-0/16553763)) |
| Airoha AB1585, AB1595 | AB1585: LE Audio, Bluetooth 5.3, HiFi 5 DSP ([release](https://prnewswire.com/news-releases/airoha-sets-10-year-milestone-with-bluetooth-le-audio-certification-301593037.html)). AB1595: six core design, up to 10 microphones, with an SDK ([audioXpress](https://audioxpress.com/news/airoha-technology-launches-flagship-wireless-ai-audio-soc)) | The SDK is supplied to customers ([SecurityWeek](https://www.securityweek.com/airoha-chip-vulnerabilities-expose-headphones-to-takeover/)); the terms are not public | Not published |
| Bestechnic BES2700YP | Dual mode Bluetooth 5.3 with LE Audio; Cortex-M55 ([CNX Software](https://www.cnx-software.com/2025/06/02/bestechnic-bes2700yp-arm-cortex-m55-bluetooth-audio-soc-targets-headphones-earbuds-portable-speakers/)) | All development resources require an NDA (same source) | Not published |
| Realtek RTL8763B, RTL8773J | RTL8763B datasheet marked "CONFIDENTIAL: Development Partners Only" ([manualslib](https://www.manualslib.com/manual/1504178/Realtek-Rtl8763b-Series.html)); RTL8773J has no public documentation or board yet ([CNX Software](https://www.cnx-software.com/?p=177310)) | Partner only | Not published |

**What this means for a startup.** The dual mode audio SoCs are what make an earbud play music
from any phone over Classic Bluetooth, but their SDKs sit behind vendor approval and NDAs,
and their terms are not public. Nordic plus Cirrus is open and has a kit today, and covers
music only over LE Audio. Build Rev A and Rev B on Nordic plus Cirrus, keep the SSP firmware
portable C ([firmware/ssp.c](firmware/ssp.c) has no dependencies beyond the C standard
headers), and choose the production audio SoC together with the ODM.

## Dry contact materials and suppliers

| Supplier and product | What it is (verified) | Fit for the earbud | Pricing |
|---|---|---|---|
| Datwyler [SoftPulse](https://datwyler.com/company/innovation/softpulse/technology/) | Electrically conductive elastomer, 83 ± 5 Shore A, coated with silver and silver chloride; average electrode to tissue impedance 25 to 200 kΩ at 10 Hz | Closest off the shelf match to SPEC HW-EEG-03 and -04; ask for ear tip geometries | On request |
| IDUN Technologies [Dryode, Guardian](https://iduntechnologies.com/) | Dryode Duo: 2 channel ear tip dry contact EEG sensors, both in the canal, impedance under 20 to 200 kΩ typical. Guardian 4 dev kit: 250 Hz, Bluetooth 5.4 | A ready in-canal dry contact reference to benchmark ours against (SPEC T-03, T-07) | Guardian 4 starter CHF 999 in presale, CHF 1,299 after |
| Wacker [ELASTOSIL LR 3162](https://www.wacker.com/h/en-us/c/elastosil-lr-3162-ab/p/000009484) | Electrically conductive liquid silicone rubber; a distributor sheet lists 11 Ω·cm volume resistivity and Shore A 53 ([distributor](https://www.sushengpolymer.com/plasmain/aed5Qi_ELASTOSIL-LR-3162-A-B/)). Wacker states it does not comply with pharmaceutical and food regulations | Mouldable conductive tips; needs an Ag/AgCl surface and our own biocompatibility testing | Quote only |
| Shin-Etsu EC-BM conductive silicone | 0.025 Ω·m volume resistivity, 70 Durometer A, carbon filled ([distributor](https://www.microsi.com/?p=160)) | As above | Not shown |
| Statex Shieldex (Med-Tex P130) | Nylon metallised with 99% pure silver ([Swicofil](https://www.swicofil.com/commerce/suppliers/partners/statex)); tested as an electrode and found more sensitive to noise ([study](https://pmc.ncbi.nlm.nih.gov/articles/PMC5879742)) | Quick textile prototypes on foam tips, as the brief's stage 1 suggests | Not public |
| Micromax Ag/AgCl ink (product 5881) | Silver and silver chloride ink for healthcare, launched by DuPont in 2022 ([Microwave Journal](https://microwavejournal.com/articles/37876-dupont-mcm-launches-next-gen-conductive-ink)); the Micromax business now belongs to Element Solutions (completed 2 Feb 2026, [I-Connect007](https://iconnect007.com/article/148654/element-solutions-inc-completes-acquisition-of-micromax-business/148651/ein)) | Printing Ag/AgCl contacts on flex or tip inserts, as cEEGrids are printed | Not public |

For context, shipping ear EEG products and their contacts: NextSense, three dry contacts of
flexible conductive polymer per earbud ([report](https://villpress.com/?p=7979)); IDUN
Guardian, two in-canal channels per earpiece (above); Neurable, 12 dry fabric sensors in the
ear cushions of a headphone ([Neurable](https://www.neurable.com/shop)).

## Dev kit: reproduce the data set conditions today

The public data set behind the analysis was recorded with cEEGrids around both ears at 500 Hz,
referenced to R4b with R4a as ground ([Holtze et al. 2022](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2022.869426/full)).
The closest setup available off the shelf, reachable from lib/sense today through
`CytonSerialTransport`:

| Item | Why | Verified figures | Price |
|---|---|---|---|
| OpenBCI [Cyton](https://docs.openbci.com/Cyton/CytonLanding/) | The dev kit SSP source: lib/sense re-encodes its packets as SSP, side 2 ([PROTOCOL.md](PROTOCOL.md)) | 8 channels on an ADS1299; 250 Hz by default and at most over its radio ("The Cyton cannot stream data over 250Hz", [SDK](https://docs.openbci.com/Cyton/CytonSDK/)); the USB dongle is an FTDI virtual serial port at 115200 baud, 8-N-1 ([data format](https://docs.openbci.com/Cyton/CytonDataFormat/), [specs](https://docs.openbci.com/Cyton/CytonSpecs/)) | To verify (the OpenBCI shop refused requests on 2026-11-02) |
| Not the Daisy add-on | 16 channels, but the rate per board halves to 125 Hz over the radio ([OpenBCI](https://docs.openbci.com/FAQ/HowProductsGoTogether)), below the 250 Hz minimum (SPEC HW-AFE-03). The WiFi Shield that streamed faster is no longer sold ([OpenBCI](https://docs.openbci.com/Deprecated/WiFiShield/WiFiLanding/)) | | |
| cEEGrid arrays | The electrodes the data set used | 10 electrodes per ear in a C; v3 uses silver ink for sensors, wiring and connectors; sold by TMSi and EasyCap ([University of Oldenburg](https://uol.de/en/psychologie/abteilungen/ceegrid/description)); Ag/AgCl ink, 3 mm electrodes ([Bleichner and Debener 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5383730/)) | To verify; consumable |
| Open cEEGrid adapter | Connects cEEGrids to the Cyton | Knierim, Schemmer and Bauer, HardwareX 2022 ([paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9529594/), [GitHub](https://github.com/MKnierim/openbci-ceegrids)); OpenBCI documents a cEEGrid kit ([docs](https://docs.openbci.com/ThirdParty/cEEGrid_Kit/)) | The paper lists about 40 USD for connectors and enclosure and about 1,500 USD for amplifier and electrodes (2022 figures) |
| Electrolyte gel, skin preparation | cEEGrids use a little electrolyte | | Estimate, small |
| Two talker playback | Two audiobooks at once, one left and one right, as in the data set | | Existing equipment |
| Chrome or Edge on a desktop computer | Runs lib/sense with Web Serial | Web Serial works in Chrome and Edge from version 89, not in Safari ([caniuse](https://caniuse.com/web-serial)) | Free |
| Nordic nRF5340 Audio DK | Prototype the steered audio path and measure its power before Rev A (SPEC T-10, T-12) | nRF5340, CS47L63 audio DSP, nPM1100 PMIC, current measurement pins ([Nordic](https://www.nordicsemi.com/Products/Development-hardware/nRF5340-Audio-DK)) | To verify |
| AFE evaluation module (ADS1294R or AFE159RP4) | Compare the earbud AFE's noise with the Cyton's ADS1299 on the same inputs before any custom board, as the client brief's sequence asks | | To verify |
| Optional: IDUN Guardian 4 | An in-canal dry contact reference | See the materials table | CHF 999 presale |

**Wiring the Cyton to match the data set.** Reference (SRB2) to R4b, bias to R4a, and the eight
channels to the lead's best electrodes: left L01, L04b, L06, L04 and right R02, R05, R08, R04
([research/aad/README.md](../research/aad/README.md)); the pin mapping follows the adapter's
documentation. The recording is then the wired montage, and the phone derives the wireless
montage from the same samples by referencing each ear to its own average. At 250 Hz the
clench detector clamps its band to 30 to 112.5 Hz ([clench.ts](../lib/sense/clench.ts)). What
the dev kit cannot show: dry contacts in the ear, and two electrically separate earbuds (SPEC
T-08).
