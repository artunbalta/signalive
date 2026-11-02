/*
 * The cross language fixture for SSP v0. Builds a fixed stream of frames
 * with the C reference encoder and writes the bytes (ssp-golden.bin) next to
 * what each frame must decode to (ssp-golden.json). lib/sense/protocol.test.ts
 * decodes the bytes with the TypeScript decoder and re-encodes the values
 * with the TypeScript encoder, so firmware and phone are checked against each
 * other rather than each against itself.
 *
 * The stream holds both earbuds and a dev kit, int24 extremes, a device clock
 * that wraps, an IMU, EVENT and AUDIO_ENV frame, and one frame whose CRC is
 * deliberately wrong, which costs the right earbud one sequence number. It
 * also checks the encoder's own edges and the command parser, and exits non
 * zero (writing nothing) if any check fails.
 *
 *   golden <ssp-golden.bin> <ssp-golden.json>
 *
 * A host tool, so unlike ssp.c it may use stdio.
 */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ssp.h"

#define STREAM_CAP 8192u
#define MAX_ENTRIES 32u
#define JSON_CAP 65536u

static uint8_t stream[STREAM_CAP];
static size_t stream_len;

/* What the decoder must report: one entry per frame in stream order. */
typedef struct {
    size_t offset;
    size_t length;
    int corrupt;
    uint8_t type;
    uint8_t side;
    uint16_t seq;
} entry;

static entry entries[MAX_ENTRIES];
static size_t entry_count;

static const entry *entry_at(size_t offset)
{
    size_t i;
    for (i = 0; i < entry_count; i++) {
        if (entries[i].offset == offset) {
            return &entries[i];
        }
    }
    return NULL;
}

static char json[JSON_CAP];
static size_t json_len;
static int failures;

static void check(int ok, const char *what)
{
    if (!ok) {
        fprintf(stderr, "golden: FAIL %s\n", what);
        failures++;
    }
}

/* Appends to the JSON text; the fixture is written only once every check
 * has passed. */
static void out(const char *fmt, ...)
{
    va_list ap;
    int n;
    va_start(ap, fmt);
    n = vsnprintf(json + json_len, JSON_CAP - json_len, fmt, ap);
    va_end(ap);
    if (n < 0 || (size_t)n >= JSON_CAP - json_len) {
        check(0, "json buffer");
        return;
    }
    json_len += (size_t)n;
}

static const char *side_name(uint8_t side)
{
    switch (side) {
    case SSP_SIDE_LEFT:
        return "left";
    case SSP_SIDE_RIGHT:
        return "right";
    default:
        return "single";
    }
}

/* A fixed linear congruential generator, so the fixture never changes
 * unless this file does. Covers the whole int24 range. */
static uint32_t lcg_state = 0x5349474Eu;

static int32_t lcg_i24(void)
{
    lcg_state = lcg_state * 1664525u + 1013904223u;
    return (int32_t)(lcg_state >> 8) - 8388608L;
}

static int32_t clamp24(int32_t v)
{
    if (v > (int32_t)SSP_INT24_MAX) {
        return (int32_t)SSP_INT24_MAX;
    }
    if (v < (int32_t)SSP_INT24_MIN) {
        return (int32_t)SSP_INT24_MIN;
    }
    return v;
}

static void begin_entry(size_t offset, size_t length, int corrupt, uint8_t type,
                        const ssp_header *h, const char *name)
{
    entry *e;
    check(length > 0u, name);
    if (entry_count >= MAX_ENTRIES) {
        check(0, "too many entries");
        return;
    }
    e = &entries[entry_count];
    e->offset = offset;
    e->length = length;
    e->corrupt = corrupt;
    e->type = type;
    e->side = h->side;
    e->seq = h->seq;
    out("%s\n    {\"offset\": %lu, \"length\": %lu, \"corrupt\": %s, \"frame\": {", entry_count ? "," : "",
        (unsigned long)offset, (unsigned long)length, corrupt ? "true" : "false");
    out("\"type\": \"%s\", \"side\": \"%s\", \"seq\": %u, \"timestamp\": %lu, \"flags\": %u", name,
        side_name(h->side), (unsigned)h->seq, (unsigned long)h->timestamp_us, (unsigned)h->flags);
    entry_count++;
}

static void label_json(const char *label)
{
    size_t j;
    out("\"");
    for (j = 0; j < SSP_LABEL_SIZE && label[j] != '\0'; j++) {
        if (label[j] == '"' || label[j] == '\\') {
            out("\\%c", label[j]);
        } else {
            out("%c", label[j]);
        }
    }
    out("\"");
}

static void put_hello(const ssp_header *h, const ssp_hello *hello)
{
    size_t off = stream_len;
    size_t len = ssp_encode_hello(stream + off, STREAM_CAP - off, h, hello);
    size_t i;
    stream_len += len;
    begin_entry(off, len, 0, SSP_TYPE_HELLO, h, "hello");
    out(", \"firmware\": [%u, %u, %u], \"deviceId\": \"", (unsigned)hello->fw_major,
        (unsigned)hello->fw_minor, (unsigned)hello->fw_patch);
    for (i = 0; i < sizeof hello->device_id; i++) {
        out("%02x", (unsigned)hello->device_id[i]);
    }
    out("\", \"labels\": [");
    for (i = 0; i < hello->channel_count; i++) {
        out("%s", i ? ", " : "");
        label_json(hello->labels[i]);
    }
    out("], \"eegRate\": %u, \"nvPerLsb\": %.17g, \"imuRate\": %u, \"battery\": %u}}",
        (unsigned)hello->eeg_rate_hz, (double)hello->nv_per_lsb, (unsigned)hello->imu_rate_hz,
        (unsigned)hello->battery_percent);
}

static size_t put_eeg(const ssp_header *h, const int32_t *samples, uint8_t n, uint8_t channels,
                      int corrupt)
{
    size_t off = stream_len;
    size_t len = ssp_encode_eeg(stream + off, STREAM_CAP - off, h, samples, n, channels);
    size_t i;
    stream_len += len;
    if (corrupt && len > 0u) {
        /* The CRC's low byte, inverted: every other byte is as encoded. */
        stream[off + len - 2u] ^= 0xFFu;
    }
    begin_entry(off, len, corrupt, SSP_TYPE_EEG, h, "eeg");
    out(", \"channels\": %u, \"samples\": %u, \"counts\": [", (unsigned)channels, (unsigned)n);
    for (i = 0; i < (size_t)n * channels; i++) {
        out(i ? ",%ld" : "%ld", (long)clamp24(samples[i]));
    }
    out("]}}");
    return off;
}

static void put_imu(const ssp_header *h, const ssp_imu_sample *samples, uint8_t n)
{
    size_t off = stream_len;
    size_t len = ssp_encode_imu(stream + off, STREAM_CAP - off, h, samples, n);
    size_t i;
    size_t k;
    stream_len += len;
    begin_entry(off, len, 0, SSP_TYPE_IMU, h, "imu");
    out(", \"samples\": %u, \"values\": [", (unsigned)n);
    for (i = 0; i < n; i++) {
        for (k = 0; k < 3u; k++) {
            out((i || k) ? ",%d" : "%d", (int)samples[i].accel[k]);
        }
        for (k = 0; k < 3u; k++) {
            out(",%d", (int)samples[i].gyro[k]);
        }
        for (k = 0; k < 4u; k++) {
            out(",%d", (int)samples[i].quat[k]);
        }
    }
    out("]}}");
}

static void put_event(const ssp_header *h, uint8_t code, uint32_t value)
{
    size_t off = stream_len;
    size_t len = ssp_encode_event(stream + off, STREAM_CAP - off, h, code, value);
    stream_len += len;
    begin_entry(off, len, 0, SSP_TYPE_EVENT, h, "event");
    out(", \"code\": %u, \"value\": %lu}}", (unsigned)code, (unsigned long)value);
}

static void put_env(const ssp_header *h, const int16_t *azimuth_deci, const uint16_t *env,
                    uint8_t n, uint8_t talkers)
{
    size_t off = stream_len;
    size_t len = ssp_encode_audio_env(stream + off, STREAM_CAP - off, h, azimuth_deci, env, n,
                                      talkers);
    size_t i;
    stream_len += len;
    begin_entry(off, len, 0, SSP_TYPE_AUDIO_ENV, h, "audioEnv");
    out(", \"samples\": %u, \"talkers\": %u, \"azimuths\": [", (unsigned)n, (unsigned)talkers);
    for (i = 0; i < talkers; i++) {
        out(i ? ", %.1f" : "%.1f", (double)azimuth_deci[i] / 10.0);
    }
    out("], \"envelopes\": [");
    for (i = 0; i < (size_t)n * talkers; i++) {
        out(i ? ",%u" : "%u", (unsigned)env[i]);
    }
    out("]}}");
}

static const char *op_name(uint8_t op)
{
    switch (op) {
    case SSP_CMD_START:
        return "start";
    case SSP_CMD_STOP:
        return "stop";
    case SSP_CMD_SET_EEG_RATE:
        return "setEegRate";
    case SSP_CMD_STEER:
        return "steer";
    default:
        return "hello";
    }
}

/* Encodes a command, parses it back, and records both for the TypeScript
 * side, whose encoder must produce the same bytes. */
static unsigned commands;

static void put_command(int first, const ssp_header *h, const ssp_command *cmd)
{
    uint8_t buf[64];
    ssp_command back;
    size_t len = ssp_encode_command(buf, sizeof buf, h, cmd);
    size_t i;
    commands++;
    check(len > 0u, "encode command");
    check(ssp_parse_command(buf, len, &back) == SSP_OK, "parse command");
    check(back.side == h->side && back.seq == h->seq && back.timestamp_us == h->timestamp_us &&
              back.flags == h->flags && back.op == cmd->op && back.eeg_rate_hz == cmd->eeg_rate_hz &&
              back.azimuth_deci == cmd->azimuth_deci && back.gain_deci_db == cmd->gain_deci_db,
          "command round trip");
    out("%s\n    {\"hex\": \"", first ? "" : ",");
    for (i = 0; i < len; i++) {
        out("%02x", (unsigned)buf[i]);
    }
    out("\", \"frame\": {\"type\": \"command\", \"side\": \"%s\", \"seq\": %u, \"timestamp\": %lu, "
        "\"flags\": %u, \"command\": {\"op\": \"%s\"",
        side_name(h->side), (unsigned)h->seq, (unsigned long)h->timestamp_us, (unsigned)h->flags,
        op_name(cmd->op));
    if (cmd->op == SSP_CMD_SET_EEG_RATE) {
        out(", \"rate\": %u", (unsigned)cmd->eeg_rate_hz);
    } else if (cmd->op == SSP_CMD_STEER) {
        out(", \"azimuthDeg\": %.1f, \"gainDb\": %.1f", (double)cmd->azimuth_deci / 10.0,
            (double)cmd->gain_deci_db / 10.0);
    }
    out("}}}");
}

static void set_label(ssp_hello *hello, size_t i, const char *s)
{
    memset(hello->labels[i], 0, SSP_LABEL_SIZE);
    memcpy(hello->labels[i], s, strlen(s) < SSP_LABEL_SIZE ? strlen(s) : SSP_LABEL_SIZE);
}

static ssp_header header(uint8_t side, uint8_t flags, uint16_t seq, uint32_t timestamp_us)
{
    ssp_header h;
    h.side = side;
    h.flags = flags;
    h.seq = seq;
    h.timestamp_us = timestamp_us;
    return h;
}

/* Re-signs a command frame after a test has edited it, so the edit and not
 * the CRC is what the parser rejects. */
static void resign(uint8_t *buf, size_t len)
{
    uint16_t crc = ssp_crc16(buf, len - 2u);
    buf[len - 2u] = (uint8_t)(crc & 0xFFu);
    buf[len - 1u] = (uint8_t)(crc >> 8);
}

/* Does the UUID string read, byte for byte, as SSP_UUID_LE(n) reversed? */
static int uuid_matches(const char *text, uint8_t n)
{
    const uint8_t le[3][16] = {SSP_UUID_LE(1), SSP_UUID_LE(2), SSP_UUID_LE(3)};
    size_t i = 0;
    size_t k = 0;
    while (text[i] != '\0' && k < 16u) {
        unsigned v;
        if (text[i] == '-') {
            i++;
            continue;
        }
        if (sscanf(text + i, "%2x", &v) != 1 || v != le[n - 1u][15u - k]) {
            return 0;
        }
        i += 2u;
        k++;
    }
    return k == 16u && text[i] == '\0';
}

/* The encoder's and parser's edges, none of which reach the fixture. */
static void self_test(void)
{
    static const uint8_t check_input[] = {'1', '2', '3', '4', '5', '6', '7', '8', '9'};
    uint8_t a[SSP_MAX_FRAME];
    uint8_t b[SSP_MAX_FRAME];
    int32_t samples[255];
    int32_t wide[2] = {9000000L, -9000000L};
    int32_t rails[2] = {SSP_INT24_MAX, SSP_INT24_MIN};
    ssp_header h = header(SSP_SIDE_LEFT, 0, 1, 2);
    ssp_header bad_side = header(3, 0, 1, 2);
    ssp_command cmd;
    ssp_command got;
    size_t len;
    size_t la;
    size_t lb;

    check(ssp_crc16(check_input, sizeof check_input) == 0x29B1u, "CRC-16/CCITT-FALSE check value");
    check(uuid_matches(SSP_SERVICE_UUID, 1) && uuid_matches(SSP_FRAMES_UUID, 2) &&
              uuid_matches(SSP_COMMANDS_UUID, 3),
          "UUID strings and little endian bytes agree");

    check(ssp_max_eeg_samples(4, SSP_BLE_MAX_FRAME) == 18u, "18 samples of 4 channels per frame");
    check(ssp_max_eeg_samples(8, SSP_BLE_MAX_FRAME) == 9u, "9 samples of 8 channels per frame");
    check(ssp_max_eeg_samples(0, SSP_BLE_MAX_FRAME) == 0u, "no channels");
    check(ssp_max_eeg_samples(33, SSP_BLE_MAX_FRAME) == 0u, "too many channels");
    check(ssp_max_imu_samples(SSP_BLE_MAX_FRAME) == 11u, "11 IMU samples per frame");
    check(ssp_max_env_samples(2, SSP_BLE_MAX_FRAME) == 55u, "55 envelope samples of 2 talkers");

    memset(samples, 0, sizeof samples);
    check(ssp_encode_eeg(a, sizeof a, &h, samples, 18, 4) == 234u, "4 channel frame is 234 bytes");
    check(ssp_encode_eeg(a, 233, &h, samples, 18, 4) == 0u, "refuses a buffer one byte short");
    check(ssp_encode_eeg(a, sizeof a, &h, samples, 0, 4) == 0u, "refuses zero samples");
    check(ssp_encode_eeg(a, sizeof a, &h, samples, 1, 33) == 0u, "refuses 33 channels");
    check(ssp_encode_eeg(a, sizeof a, &h, samples, 255, 32) == 0u, "refuses a frame over 1024");
    check(ssp_encode_eeg(a, sizeof a, &bad_side, samples, 1, 1) == 0u, "refuses side 3");
    check(ssp_encode_eeg(NULL, sizeof a, &h, samples, 1, 1) == 0u, "refuses no buffer");
    check(ssp_encode_event(a, SSP_OVERHEAD + 4u, &h, 1, 1) == 0u, "event needs 21 bytes");

    la = ssp_encode_eeg(a, sizeof a, &h, wide, 1, 2);
    lb = ssp_encode_eeg(b, sizeof b, &h, rails, 1, 2);
    check(la == lb && la > 0u && memcmp(a, b, la) == 0, "out of range counts saturate");

    /* The command parser: every way a write can be wrong. */
    memset(&cmd, 0, sizeof cmd);
    cmd.op = SSP_CMD_STEER;
    cmd.azimuth_deci = -305;
    cmd.gain_deci_db = 60;
    len = ssp_encode_command(a, sizeof a, &h, &cmd);
    check(len == SSP_OVERHEAD + 5u, "steer command is 21 bytes");
    check(ssp_parse_command(a, len, &got) == SSP_OK && got.azimuth_deci == -305 &&
              got.gain_deci_db == 60,
          "steer parses");
    check(ssp_parse_command(a, SSP_OVERHEAD, &got) == SSP_ERR_SHORT, "short write");
    check(ssp_parse_command(a, len - 1u, &got) == SSP_ERR_LENGTH, "truncated write");

    memcpy(b, a, len);
    b[len - 1u] ^= 0x01u;
    check(ssp_parse_command(b, len, &got) == SSP_ERR_CRC, "bad CRC");

    memcpy(b, a, len);
    b[0] = 0x00u;
    check(ssp_parse_command(b, len, &got) == SSP_ERR_MAGIC, "bad magic");

    memcpy(b, a, len);
    b[2] = 1u;
    resign(b, len);
    check(ssp_parse_command(b, len, &got) == SSP_ERR_VERSION, "future version");

    memcpy(b, a, len);
    b[3] = SSP_TYPE_EEG;
    resign(b, len);
    check(ssp_parse_command(b, len, &got) == SSP_ERR_TYPE, "not a command");

    memcpy(b, a, len);
    b[4] = 3u;
    resign(b, len);
    check(ssp_parse_command(b, len, &got) == SSP_ERR_SIDE, "side 3");

    memcpy(b, a, len);
    b[SSP_HEADER_SIZE] = 0x7Fu;
    resign(b, len);
    check(ssp_parse_command(b, len, &got) == SSP_ERR_COMMAND, "unknown operation");

    /* A STEER cut to 3 payload bytes, re-signed: too short for its arguments. */
    memcpy(b, a, SSP_HEADER_SIZE + 3u);
    b[12] = 3u;
    resign(b, SSP_OVERHEAD + 3u);
    check(ssp_parse_command(b, SSP_OVERHEAD + 3u, &got) == SSP_ERR_LENGTH, "steer without gain");

    /* A STEER from a newer phone with two extra bytes still parses. */
    memcpy(b, a, SSP_HEADER_SIZE + 5u);
    b[12] = 7u;
    b[SSP_HEADER_SIZE + 5u] = 0xAAu;
    b[SSP_HEADER_SIZE + 6u] = 0xBBu;
    resign(b, SSP_OVERHEAD + 7u);
    check(ssp_parse_command(b, SSP_OVERHEAD + 7u, &got) == SSP_OK && got.azimuth_deci == -305,
          "extended steer");

    cmd.op = 0x7Fu;
    check(ssp_encode_command(a, sizeof a, &h, &cmd) == 0u, "refuses to encode an unknown op");
}

static void hex_dump(const char *title, size_t off, size_t len)
{
    size_t i;
    printf("%s (%lu bytes)\n", title, (unsigned long)len);
    for (i = 0; i < len; i++) {
        if (i % 16u == 0u) {
            printf("%04lx ", (unsigned long)i);
        }
        printf(" %02x", (unsigned)stream[off + i]);
        if (i % 16u == 15u || i + 1u == len) {
            printf("\n");
        }
    }
}

static int write_file(const char *path, const void *data, size_t len)
{
    FILE *f = fopen(path, "wb");
    if (f == NULL) {
        fprintf(stderr, "golden: cannot write %s\n", path);
        return 0;
    }
    if (fwrite(data, 1, len, f) != len) {
        fclose(f);
        fprintf(stderr, "golden: short write %s\n", path);
        return 0;
    }
    return fclose(f) == 0;
}

int main(int argc, char **argv)
{
    /* ADS1299 class front end at gain 24: 4.5 V / 24 / 2^23 per count. */
    const float earbud_nv = (float)(4.5e9 / 24.0 / 8388608.0);
    /* OpenBCI's own scale for the Cyton: 4.5 V / 24 / (2^23 - 1). */
    const float devkit_nv = (float)(4.5e9 / 24.0 / 8388607.0);
    static const int32_t dc[4] = {-152340L, 48211L, 731002L, -9031L};
    static const uint8_t left_id[8] = {0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE};
    static const uint8_t right_id[8] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF};
    static const uint8_t kit_id[8] = {'D', 'E', 'V', 'K', 'I', 'T', 0x00, 0x01};
    static const char *const kit_labels[8] = {"Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "TP10"};
    const uint32_t left_t0 = 1000000UL;
    /* The right earbud's clock is 67 ms from wrapping, so its third frame
     * carries a wrapped timestamp. */
    const uint32_t right_t0 = 4294900000UL;
    const uint32_t eeg_frame_us = 18UL * 4000UL; /* 18 samples at 250 Hz */
    ssp_hello hello;
    ssp_header h;
    ssp_imu_sample imu[5];
    ssp_command cmd;
    int32_t eeg[18 * 4];
    int32_t kit[9 * 8];
    int16_t azimuth[2] = {-305, 450};
    uint16_t env[16 * 2];
    size_t realistic = 0;
    size_t corrupt_off;
    size_t i;
    size_t s;
    size_t c;
    long last_seq[3] = {-1, -1, -1};
    unsigned frames = 0;
    unsigned crc_errors = 0;
    unsigned gaps = 0;
    unsigned lost = 0;

    if (argc != 3) {
        fprintf(stderr, "usage: golden <ssp-golden.bin> <ssp-golden.json>\n");
        return 2;
    }

    self_test();

    out("{\n  \"note\": \"Written by hardware/firmware/golden.c through build.sh. Do not edit.\",\n");
    out("  \"frames\": [");

    /* HELLO, left and right: how to read everything that follows. */
    memset(&hello, 0, sizeof hello);
    hello.fw_major = 0;
    hello.fw_minor = 1;
    hello.fw_patch = 0;
    hello.channel_count = 4;
    memcpy(hello.device_id, left_id, 8);
    set_label(&hello, 0, "L1");
    set_label(&hello, 1, "L2");
    set_label(&hello, 2, "L3");
    set_label(&hello, 3, "L4");
    hello.eeg_rate_hz = 250;
    hello.nv_per_lsb = earbud_nv;
    hello.imu_rate_hz = 100;
    hello.battery_percent = 87;
    h = header(SSP_SIDE_LEFT, SSP_FLAG_STREAM_START, 0, left_t0);
    put_hello(&h, &hello);

    memcpy(hello.device_id, right_id, 8);
    set_label(&hello, 0, "R1");
    set_label(&hello, 1, "R2");
    set_label(&hello, 2, "R3");
    set_label(&hello, 3, "R4");
    hello.battery_percent = 91;
    h = header(SSP_SIDE_RIGHT, SSP_FLAG_STREAM_START, 0, right_t0);
    put_hello(&h, &hello);

    /* Left EEG: what a real frame looks like, electrode offsets of a few
     * millivolts plus a 10 Hz wave of 20 microvolts and a little noise. */
    for (s = 0; s < 18u; s++) {
        for (c = 0; c < 4u; c++) {
            long x = (long)((s + 6u * c) % 25u);
            long tri = labs(x * 4L - 50L) * 36L - 900L;
            eeg[s * 4u + c] = dc[c] + (int32_t)tri + (int32_t)(lcg_i24() / 131072L);
        }
    }
    h = header(SSP_SIDE_LEFT, 0, 1, left_t0);
    realistic = put_eeg(&h, eeg, 18, 4, 0);

    for (i = 0; i < 18u * 4u; i++) {
        eeg[i] = lcg_i24();
    }
    h = header(SSP_SIDE_RIGHT, 0, 1, right_t0);
    put_eeg(&h, eeg, 18, 4, 0);

    /* Left EEG: the int24 edges, then the whole range. */
    for (i = 0; i < 18u * 4u; i++) {
        eeg[i] = lcg_i24();
    }
    eeg[0] = SSP_INT24_MAX;
    eeg[1] = SSP_INT24_MIN;
    eeg[2] = 0;
    eeg[3] = -1;
    eeg[4] = 1;
    eeg[5] = -2;
    eeg[6] = 0x00FFFF;
    eeg[7] = -0x010000L;
    eeg[8] = 0x123456L;
    eeg[9] = -0x123456L;
    eeg[10] = SSP_INT24_MAX - 1;
    eeg[11] = SSP_INT24_MIN + 1;
    h = header(SSP_SIDE_LEFT, 0, 2, left_t0 + eeg_frame_us);
    put_eeg(&h, eeg, 18, 4, 0);

    /* Right EEG seq 2: the corrupted one. */
    for (i = 0; i < 18u * 4u; i++) {
        eeg[i] = lcg_i24();
    }
    h = header(SSP_SIDE_RIGHT, 0, 2, right_t0 + eeg_frame_us);
    corrupt_off = put_eeg(&h, eeg, 18, 4, 1);

    /* Left IMU: a head turning right at 120 degrees per second, through 30
     * degrees of yaw, then one sample of int16 extremes. */
    {
        static const int16_t qw[4] = {15826, 15780, 15733, 15685};
        static const int16_t qz[4] = {4240, 4406, 4571, 4735};
        for (i = 0; i < 4u; i++) {
            imu[i].accel[0] = (int16_t)(12 + (int)i);
            imu[i].accel[1] = (int16_t)(-8 - (int)i);
            imu[i].accel[2] = (int16_t)(-1003 + (int)i);
            imu[i].gyro[0] = 3;
            imu[i].gyro[1] = -2;
            imu[i].gyro[2] = 1200;
            imu[i].quat[0] = qw[i];
            imu[i].quat[1] = 0;
            imu[i].quat[2] = 0;
            imu[i].quat[3] = qz[i];
        }
        imu[4].accel[0] = 32767;
        imu[4].accel[1] = -32768;
        imu[4].accel[2] = -1;
        imu[4].gyro[0] = 1;
        imu[4].gyro[1] = -32768;
        imu[4].gyro[2] = 32767;
        imu[4].quat[0] = SSP_QUAT_ONE;
        imu[4].quat[1] = -SSP_QUAT_ONE;
        imu[4].quat[2] = 32767;
        imu[4].quat[3] = -32768;
        h = header(SSP_SIDE_LEFT, 0, 3, left_t0);
        put_imu(&h, imu, 5);
    }

    /* Right EEG seq 3, after the wrap; seq 2 never arrives intact. */
    for (i = 0; i < 18u * 4u; i++) {
        eeg[i] = lcg_i24();
    }
    h = header(SSP_SIDE_RIGHT, 0, 3, (uint32_t)(right_t0 + 2UL * eeg_frame_us));
    put_eeg(&h, eeg, 18, 4, 0);

    h = header(SSP_SIDE_LEFT, 0, 4, left_t0 + 100000UL);
    put_event(&h, SSP_EVENT_BATTERY, 86);

    h = header(SSP_SIDE_RIGHT, SSP_FLAG_LEAD_OFF, 4, 100000UL);
    put_event(&h, SSP_EVENT_LEAD_OFF, 0x05UL);

    /* Two talkers, one 30.5 degrees left and one 45 degrees right. */
    for (s = 0; s < 16u; s++) {
        env[s * 2u] = (uint16_t)(s * 3001u);
        env[s * 2u + 1u] = (uint16_t)(65535u - s * 1777u);
    }
    h = header(SSP_SIDE_LEFT, 0, 5, left_t0);
    put_env(&h, azimuth, env, 16, 2);

    /* A dev kit: one device, eight channels, its own scale. */
    memset(&hello, 0, sizeof hello);
    hello.channel_count = 8;
    memcpy(hello.device_id, kit_id, 8);
    for (i = 0; i < 8u; i++) {
        set_label(&hello, i, kit_labels[i]);
    }
    hello.eeg_rate_hz = 250;
    hello.nv_per_lsb = devkit_nv;
    hello.imu_rate_hz = 0;
    hello.battery_percent = 255;
    h = header(SSP_SIDE_SINGLE, SSP_FLAG_STREAM_START, 0, 0);
    put_hello(&h, &hello);

    for (i = 0; i < 9u * 8u; i++) {
        kit[i] = lcg_i24();
    }
    h = header(SSP_SIDE_SINGLE, 0, 1, 0);
    put_eeg(&h, kit, 9, 8, 0);

    out("\n  ],\n");

    /* What a decoder must count over the whole stream. */
    for (i = 0; i < entry_count; i++) {
        const entry *e = &entries[i];
        if (e->corrupt) {
            crc_errors++;
            continue;
        }
        frames++;
        if (last_seq[e->side] >= 0) {
            unsigned expect = (unsigned)((last_seq[e->side] + 1L) & 0xFFFFL);
            if ((unsigned)e->seq != expect) {
                gaps++;
                lost += (unsigned)((e->seq - expect) & 0xFFFFu);
            }
        }
        last_seq[e->side] = (long)e->seq;
    }
    out("  \"stats\": {\"frames\": %u, \"crcErrors\": %u, \"gaps\": %u, \"lost\": %u},\n", frames,
        crc_errors, gaps, lost);
    check(frames == 12u && crc_errors == 1u && gaps == 1u && lost == 1u, "expected stream stats");

    /* After a CRC failure a decoder rescans from the next byte, so the bad
     * frame must not contain anything that looks like a frame start. */
    {
        const entry *bad = entry_at(corrupt_off);
        for (i = corrupt_off + 1u; bad != NULL && i + 1u < corrupt_off + bad->length; i++) {
            check(!(stream[i] == SSP_MAGIC0 && stream[i + 1u] == SSP_MAGIC1),
                  "no false magic inside the corrupted frame");
        }
    }

    out("  \"limits\": {\"eeg4\": %u, \"eeg8\": %u, \"imu\": %u, \"env2\": %u, \"env3\": %u},\n",
        (unsigned)ssp_max_eeg_samples(4, SSP_BLE_MAX_FRAME),
        (unsigned)ssp_max_eeg_samples(8, SSP_BLE_MAX_FRAME),
        (unsigned)ssp_max_imu_samples(SSP_BLE_MAX_FRAME),
        (unsigned)ssp_max_env_samples(2, SSP_BLE_MAX_FRAME),
        (unsigned)ssp_max_env_samples(3, SSP_BLE_MAX_FRAME));
    out("  \"crcCheck\": {\"input\": \"123456789\", \"crc\": %u},\n", 0x29B1u);
    out("  \"uuids\": {\"service\": \"%s\", \"frames\": \"%s\", \"commands\": \"%s\"},\n",
        SSP_SERVICE_UUID, SSP_FRAMES_UUID, SSP_COMMANDS_UUID);

    /* Commands, phone to earbud. */
    out("  \"commands\": [");
    memset(&cmd, 0, sizeof cmd);
    cmd.op = SSP_CMD_START;
    h = header(SSP_SIDE_LEFT, 0, 0, 0);
    put_command(1, &h, &cmd);
    cmd.op = SSP_CMD_STOP;
    h = header(SSP_SIDE_RIGHT, 0, 1, 1000);
    put_command(0, &h, &cmd);
    cmd.op = SSP_CMD_SET_EEG_RATE;
    cmd.eeg_rate_hz = 500;
    h = header(SSP_SIDE_SINGLE, 0, 2, 2000);
    put_command(0, &h, &cmd);
    memset(&cmd, 0, sizeof cmd);
    cmd.op = SSP_CMD_STEER;
    cmd.azimuth_deci = -305;
    cmd.gain_deci_db = 60;
    h = header(SSP_SIDE_LEFT, 0, 3, 3000);
    put_command(0, &h, &cmd);
    cmd.azimuth_deci = 1800;
    cmd.gain_deci_db = -125;
    h = header(SSP_SIDE_RIGHT, 0, 4, 4000);
    put_command(0, &h, &cmd);
    memset(&cmd, 0, sizeof cmd);
    cmd.op = SSP_CMD_HELLO;
    h = header(SSP_SIDE_SINGLE, 0, 65535u, 4294967295UL);
    put_command(0, &h, &cmd);
    out("\n  ]\n}\n");

    if (failures > 0) {
        fprintf(stderr, "golden: %d check(s) failed, fixtures not written\n", failures);
        return 1;
    }
    if (!write_file(argv[1], stream, stream_len) || !write_file(argv[2], json, json_len)) {
        return 1;
    }
    printf("golden: %u frames (%lu bytes), %u with a bad CRC, %u commands; all checks passed\n",
           frames + crc_errors, (unsigned long)stream_len, crc_errors, commands);
    hex_dump("left EEG frame, seq 1, 18 samples x 4 channels", realistic,
             entry_at(realistic)->length);
    return 0;
}
