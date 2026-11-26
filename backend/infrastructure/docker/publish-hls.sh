#!/bin/sh
set -eu

cd /srv/hls/iptv
umask 022

cleanup() {
    rm -f program.m3u8 program.m3u8.tmp segment-*.ts segment-*.ts.tmp
}

stop() {
    kill -TERM "$publisher" 2>/dev/null || true
    wait "$publisher" || true
    exit 0
}

trap cleanup EXIT
cleanup

# Reuse the encoded Program tracks. The worker produces one keyframe per second.
ffmpeg -nostdin -hide_banner -loglevel warning \
    -i 'udp://127.0.0.1:5102?timeout=8000000&fifo_size=8192&overrun_nonfatal=1' \
    -map 0:v:0 -map 0:a:0 -c copy \
    -f hls -hls_time 1 -hls_list_size 6 -hls_delete_threshold 3 \
    -hls_flags delete_segments+independent_segments+temp_file+omit_endlist+program_date_time \
    -hls_start_number_source epoch_us -hls_segment_filename 'segment-%d.ts' program.m3u8 &
publisher=$!
trap stop INT TERM
wait "$publisher"
