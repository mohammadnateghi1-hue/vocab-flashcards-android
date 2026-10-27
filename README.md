# Vocab Flashcards Android

Offline Persian/English vocabulary flashcard app for Android.

- Add, edit and delete words
- Persian meanings
- English examples + Persian translations
- Lesson and CEFR tags
- Spaced review
- Search and filters
- JSON backup
- Text-to-speech pronunciation

GitHub Actions builds `VocabFlashcards.apk` automatically.


## Version 2
- Multi-meaning vocabulary entries with one example per sense
- Complete Lesson 10 seed deck
- US/UK text-to-speech with configurable speed
- Written IPA pronunciation
- Native XLSX import/export and blank template
- Direct TSV paste/import from ChatGPT
- Review ratings: Again / Hard / Good / Easy
- Stable signing for future APK updates


## Version 3 — Phase 1 complete
- Master Cards with independent review history
- Sense Cards with independent schedules per meaning
- Reverse review: Persian meaning to English word
- Typed Answer mode with typo-tolerant checking
- Mixed smart review mode
- Leech detection with configurable lapse threshold
- Dedicated Leech review/filter and reset
- Better library search, status filters and sorting
- Per-word quick review
- Existing multi-meaning entries and examples preserved
- Native XLSX import/export preserved
- TSV import from ChatGPT preserved
- More compatible Android file picker for XLSX files
- Existing US/UK TTS and pronunciation settings preserved


## Version 4 — independent online vocabulary lookup

- Search English words and phrases regardless of local flashcard database
- Free Dictionary API definitions, fallback to Wiktionary
- Persian translations of definitions/examples via MyMemory (best-effort and rate-limited)
- Separate senses and available dictionary-attested examples, with part of speech and IPA
- Google Books Ngram year-by-year percentage for English 2019 corpus, 1950–2019 (not spoken usage or sense frequencies)
- Wikimedia Commons image gallery, image selection and attribution link
- Save one or all meanings as reviewable cards, with selected online image
- Online lookup directly from any local library word
- Search results do not automatically change local database
- Online services require Internet; honest empty/error states for missing data

Sources: https://dictionaryapi.dev/ , https://en.wiktionary.org/ , https://mymemory.translated.net/doc/spec.php , https://books.google.com/ngrams/info , https://commons.wikimedia.org/
