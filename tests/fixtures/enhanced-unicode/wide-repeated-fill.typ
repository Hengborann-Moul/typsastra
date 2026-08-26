// Regression for Enhanced Unicode Engine v0.3.0's
// "logical component coordinate exceeds i16" font-processing failure.
// Keep the repeated content wider than 32 em so one synthesized logical unit
// would exceed a signed 16-bit TrueType component coordinate without fallback.
#set page(width: 210mm, height: 297mm, margin: 18mm)
#set text(size: 11pt)

= Wide repeated-fill regression

The fill below models a dotted outline leader. It must compile without turning
one wide logical run into an oversized TrueType composite glyph.

#box(width: 165mm, repeat[.])

The exported PDF must remain non-empty and searchable after the fallback.
