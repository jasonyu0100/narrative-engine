#!/bin/bash
# analyze-book.sh — Run chapter analysis on all chapters in a book directory.
#
# Usage:
#   ./scripts/analyze-book.sh <book-dir> [--model <model>] [--from <chapter>] [--to <chapter>]
#
# Example:
#   ./scripts/analyze-book.sh data/books/great-gatsby
#   ./scripts/analyze-book.sh data/books/great-gatsby --from 3 --to 5
#   ./scripts/analyze-book.sh data/books/great-gatsby --model google/gemini-2.5-flash

set -e

BOOK_DIR="${1:?Usage: ./scripts/analyze-book.sh <book-dir> [--model <model>] [--from N] [--to N]}"
shift

MODEL=""
FROM=1
TO=999

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --from)  FROM="$2"; shift 2 ;;
    --to)    TO="$2"; shift 2 ;;
    *)       echo "Unknown arg: $1"; exit 1 ;;
  esac
done

CHAPTERS_DIR="$BOOK_DIR/chapters"
if [ ! -d "$CHAPTERS_DIR" ]; then
  echo "Error: $CHAPTERS_DIR not found"
  exit 1
fi

# Count chapters
CHAPTER_COUNT=$(ls "$CHAPTERS_DIR"/chapter-*.txt 2>/dev/null | wc -l | tr -d ' ')
echo "Found $CHAPTER_COUNT chapters in $CHAPTERS_DIR"
echo ""

# Clamp TO
if [ "$TO" -gt "$CHAPTER_COUNT" ]; then
  TO=$CHAPTER_COUNT
fi

MODEL_ARG=""
if [ -n "$MODEL" ]; then
  MODEL_ARG="--model $MODEL"
fi

for i in $(seq "$FROM" "$TO"); do
  PADDED=$(printf "%02d" "$i")
  OUTPUT="$BOOK_DIR/analysis/chapter-$PADDED.json"

  if [ -f "$OUTPUT" ]; then
    echo "[$i/$CHAPTER_COUNT] Skipping chapter $i (already analyzed)"
    continue
  fi

  echo "[$i/$CHAPTER_COUNT] Analyzing chapter $i..."
  npx tsx scripts/analyze-chapter.ts "$BOOK_DIR" "$i" $MODEL_ARG
  echo ""

  # Brief pause between API calls
  if [ "$i" -lt "$TO" ]; then
    sleep 2
  fi
done

echo "Done! Analysis files in $BOOK_DIR/analysis/"
