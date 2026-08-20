// Directly authored lines keep source locations useful for Typsastra navigation.
#set page(width: 210mm, height: 297mm, margin: 18mm)
#set text(
  font: (
    "Khmer OS Content",
    "Nirmala UI",
    "Ebrima",
    "Arial",
    "Libertinus Serif",
  ),
  size: 14pt,
)
#set par(leading: 1.1em)

= Enhanced Unicode Engine validation

Each labeled line is extracted verbatim and checked independently. The generous
spacing also makes selection geometry failures easy to inspect in PDF viewers.

EU-LATIN-01: Café naïve coöperate — precomposed Latin text.

EU-COMBINING-01: Café naïve Å — decomposed combining sequences.

EU-KHMER-01: ភាសាខ្មែរគាំទ្រការសរសេរ ការជ្រើសរើស និងការចម្លងអត្ថបទ។

EU-KHMER-02: កម្ពុជា សិល្បៈ អក្សរសាស្ត្រ ព័ត៌មានវិទ្យា និងចំណេះដឹង។

EU-ARABIC-01: العربية تدعم ترتيب النص المنطقي والنسخ والبحث.

EU-DEVANAGARI-01: हिन्दी पाठ चयन, प्रतिलिपि और खोज का परीक्षण।

EU-THAI-01: ภาษาไทยทดสอบการเลือก การคัดลอก และการค้นหาข้อความ

EU-LAO-01: ພາສາລາວທົດສອບການເລືອກ ການສຳເນົາ ແລະ ການຄົ້ນຫາ

EU-MIXED-01: Typsastra — ភាសាខ្មែរ — العربية — हिन्दी — ภาษาไทย — ພາສາລາວ.

EU-PUNCT-01: “Logical text” — (selection) [copy] {search} … ១០០٪.
