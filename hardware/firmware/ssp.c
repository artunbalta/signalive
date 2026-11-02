/*
 * SSP v0 reference encoder. Every multi byte field is written byte by byte,
 * little endian, so the output is the same on any MCU whatever its own byte
 * order. lib/sense/protocol.ts must produce exactly these bytes; golden.c and
 * lib/sense/protocol.test.ts check that it does.
 */
#include "ssp.h"

#include <string.h>

/* HELLO carries a float32's IEEE 754 bits; refuse to build anywhere a float
 * is some other size. */
typedef char ssp_float_is_32_bits[(sizeof(float) == 4u) ? 1 : -1];

/* Byte offsets of the payload fields that are not simple arrays. */
#define HELLO_FIXED 21u
#define IMU_SAMPLE_SIZE 20u
#define EVENT_SIZE 5u

static void put_u16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)(v >> 8);
}

static void put_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
    p[2] = (uint8_t)((v >> 16) & 0xFFu);
    p[3] = (uint8_t)(v >> 24);
}

static void put_i16(uint8_t *p, int16_t v)
{
    put_u16(p, (uint16_t)v);
}

/* Two's complement, low 24 bits; out of range counts saturate rather than
 * wrap, so a clipped electrode reads as clipped and not as the opposite
 * rail. */
static void put_i24(uint8_t *p, int32_t v)
{
    uint32_t u;
    if (v > (int32_t)SSP_INT24_MAX) {
        v = (int32_t)SSP_INT24_MAX;
    } else if (v < (int32_t)SSP_INT24_MIN) {
        v = (int32_t)SSP_INT24_MIN;
    }
    u = (uint32_t)v;
    p[0] = (uint8_t)(u & 0xFFu);
    p[1] = (uint8_t)((u >> 8) & 0xFFu);
    p[2] = (uint8_t)((u >> 16) & 0xFFu);
}

static uint16_t get_u16(const uint8_t *p)
{
    return (uint16_t)((unsigned)p[0] | ((unsigned)p[1] << 8));
}

static uint32_t get_u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Written without relying on how a compiler converts an out of range
 * unsigned value to a signed one. */
static int16_t get_i16(const uint8_t *p)
{
    uint16_t u = get_u16(p);
    if (u >= 0x8000u) {
        return (int16_t)((int32_t)u - 65536L);
    }
    return (int16_t)u;
}

uint16_t ssp_crc16(const uint8_t *data, size_t len)
{
    uint16_t crc = 0xFFFFu;
    size_t i;
    int bit;
    for (i = 0; i < len; i++) {
        crc = (uint16_t)(crc ^ (uint16_t)((unsigned)data[i] << 8));
        for (bit = 0; bit < 8; bit++) {
            if ((crc & 0x8000u) != 0u) {
                crc = (uint16_t)((unsigned)(crc << 1) ^ 0x1021u);
            } else {
                crc = (uint16_t)(crc << 1);
            }
        }
    }
    return crc;
}

static uint8_t cap_u8(size_t n)
{
    return (uint8_t)(n > 255u ? 255u : n);
}

uint8_t ssp_max_eeg_samples(uint8_t channels, size_t max_frame)
{
    size_t per = 3u * (size_t)channels;
    if (channels == 0u || channels > SSP_MAX_CHANNELS) {
        return 0;
    }
    if (max_frame > SSP_MAX_FRAME) {
        max_frame = SSP_MAX_FRAME;
    }
    if (max_frame < SSP_OVERHEAD + 2u + per) {
        return 0;
    }
    return cap_u8((max_frame - SSP_OVERHEAD - 2u) / per);
}

uint8_t ssp_max_imu_samples(size_t max_frame)
{
    if (max_frame > SSP_MAX_FRAME) {
        max_frame = SSP_MAX_FRAME;
    }
    if (max_frame < SSP_OVERHEAD + 1u + IMU_SAMPLE_SIZE) {
        return 0;
    }
    return cap_u8((max_frame - SSP_OVERHEAD - 1u) / IMU_SAMPLE_SIZE);
}

uint8_t ssp_max_env_samples(uint8_t talkers, size_t max_frame)
{
    size_t fixed = SSP_OVERHEAD + 2u + 2u * (size_t)talkers;
    size_t per = 2u * (size_t)talkers;
    if (talkers == 0u || talkers > SSP_MAX_TALKERS) {
        return 0;
    }
    if (max_frame > SSP_MAX_FRAME) {
        max_frame = SSP_MAX_FRAME;
    }
    if (max_frame < fixed + per) {
        return 0;
    }
    return cap_u8((max_frame - fixed) / per);
}

/* Writes the header and returns the frame's total length, or 0 when it would
 * not fit the buffer or the protocol. */
static size_t frame_begin(uint8_t *out, size_t cap, const ssp_header *h, uint8_t type,
                          size_t payload_len)
{
    size_t total = SSP_OVERHEAD + payload_len;
    if (out == NULL || h == NULL || h->side > SSP_SIDE_SINGLE || payload_len > SSP_MAX_PAYLOAD ||
        total > cap) {
        return 0;
    }
    out[0] = (uint8_t)SSP_MAGIC0;
    out[1] = (uint8_t)SSP_MAGIC1;
    out[2] = (uint8_t)SSP_VERSION;
    out[3] = type;
    out[4] = h->side;
    out[5] = h->flags;
    put_u16(out + 6, h->seq);
    put_u32(out + 8, h->timestamp_us);
    put_u16(out + 12, (uint16_t)payload_len);
    return total;
}

static size_t frame_end(uint8_t *out, size_t total)
{
    put_u16(out + total - SSP_CRC_SIZE, ssp_crc16(out, total - SSP_CRC_SIZE));
    return total;
}

/* Printable ASCII only, so a label always reads back as what was meant. */
static uint8_t label_char(char c)
{
    unsigned char u = (unsigned char)c;
    return (uint8_t)((u >= 0x20u && u <= 0x7Eu) ? u : (unsigned char)'?');
}

size_t ssp_encode_hello(uint8_t *out, size_t cap, const ssp_header *h, const ssp_hello *hello)
{
    size_t total;
    size_t i;
    size_t j;
    uint8_t *p;
    uint32_t bits;
    if (hello == NULL || hello->channel_count == 0u || hello->channel_count > SSP_MAX_CHANNELS) {
        return 0;
    }
    total = frame_begin(out, cap, h, (uint8_t)SSP_TYPE_HELLO,
                        HELLO_FIXED + SSP_LABEL_SIZE * (size_t)hello->channel_count);
    if (total == 0u) {
        return 0;
    }
    p = out + SSP_HEADER_SIZE;
    p[0] = hello->fw_major;
    p[1] = hello->fw_minor;
    p[2] = hello->fw_patch;
    p[3] = hello->channel_count;
    memcpy(p + 4, hello->device_id, sizeof hello->device_id);
    put_u16(p + 12, hello->eeg_rate_hz);
    memcpy(&bits, &hello->nv_per_lsb, sizeof bits);
    put_u32(p + 14, bits);
    put_u16(p + 18, hello->imu_rate_hz);
    p[20] = hello->battery_percent;
    for (i = 0; i < hello->channel_count; i++) {
        uint8_t *label = p + HELLO_FIXED + SSP_LABEL_SIZE * i;
        int ended = 0;
        for (j = 0; j < SSP_LABEL_SIZE; j++) {
            char c = hello->labels[i][j];
            if (c == '\0') {
                ended = 1;
            }
            label[j] = ended ? 0u : label_char(c);
        }
    }
    return frame_end(out, total);
}

size_t ssp_encode_eeg(uint8_t *out, size_t cap, const ssp_header *h, const int32_t *samples,
                      uint8_t n, uint8_t channels)
{
    size_t count;
    size_t total;
    size_t i;
    uint8_t *p;
    if (samples == NULL || n == 0u || channels == 0u || channels > SSP_MAX_CHANNELS) {
        return 0;
    }
    count = (size_t)n * (size_t)channels;
    total = frame_begin(out, cap, h, (uint8_t)SSP_TYPE_EEG, 2u + 3u * count);
    if (total == 0u) {
        return 0;
    }
    p = out + SSP_HEADER_SIZE;
    p[0] = n;
    p[1] = channels;
    for (i = 0; i < count; i++) {
        put_i24(p + 2u + 3u * i, samples[i]);
    }
    return frame_end(out, total);
}

size_t ssp_encode_imu(uint8_t *out, size_t cap, const ssp_header *h, const ssp_imu_sample *samples,
                      uint8_t n)
{
    size_t total;
    size_t i;
    size_t k;
    uint8_t *p;
    if (samples == NULL || n == 0u) {
        return 0;
    }
    total = frame_begin(out, cap, h, (uint8_t)SSP_TYPE_IMU, 1u + IMU_SAMPLE_SIZE * (size_t)n);
    if (total == 0u) {
        return 0;
    }
    p = out + SSP_HEADER_SIZE;
    p[0] = n;
    for (i = 0; i < n; i++) {
        uint8_t *q = p + 1u + IMU_SAMPLE_SIZE * i;
        for (k = 0; k < 3u; k++) {
            put_i16(q + 2u * k, samples[i].accel[k]);
            put_i16(q + 6u + 2u * k, samples[i].gyro[k]);
        }
        for (k = 0; k < 4u; k++) {
            put_i16(q + 12u + 2u * k, samples[i].quat[k]);
        }
    }
    return frame_end(out, total);
}

size_t ssp_encode_event(uint8_t *out, size_t cap, const ssp_header *h, uint8_t code, uint32_t value)
{
    size_t total = frame_begin(out, cap, h, (uint8_t)SSP_TYPE_EVENT, EVENT_SIZE);
    if (total == 0u) {
        return 0;
    }
    out[SSP_HEADER_SIZE] = code;
    put_u32(out + SSP_HEADER_SIZE + 1u, value);
    return frame_end(out, total);
}

size_t ssp_encode_audio_env(uint8_t *out, size_t cap, const ssp_header *h,
                            const int16_t *azimuth_deci, const uint16_t *env, uint8_t n,
                            uint8_t talkers)
{
    size_t count;
    size_t total;
    size_t i;
    uint8_t *p;
    if (azimuth_deci == NULL || env == NULL || n == 0u || talkers == 0u ||
        talkers > SSP_MAX_TALKERS) {
        return 0;
    }
    count = (size_t)n * (size_t)talkers;
    total = frame_begin(out, cap, h, (uint8_t)SSP_TYPE_AUDIO_ENV,
                        2u + 2u * (size_t)talkers + 2u * count);
    if (total == 0u) {
        return 0;
    }
    p = out + SSP_HEADER_SIZE;
    p[0] = n;
    p[1] = talkers;
    for (i = 0; i < talkers; i++) {
        put_i16(p + 2u + 2u * i, azimuth_deci[i]);
    }
    p += 2u + 2u * (size_t)talkers;
    for (i = 0; i < count; i++) {
        put_u16(p + 2u * i, env[i]);
    }
    return frame_end(out, total);
}

/* Payload bytes each operation needs, its code included; 0 for an unknown
 * operation. */
static size_t command_size(uint8_t op)
{
    switch (op) {
    case SSP_CMD_START:
    case SSP_CMD_STOP:
    case SSP_CMD_HELLO:
        return 1u;
    case SSP_CMD_SET_EEG_RATE:
        return 3u;
    case SSP_CMD_STEER:
        return 5u;
    default:
        return 0u;
    }
}

size_t ssp_encode_command(uint8_t *out, size_t cap, const ssp_header *h, const ssp_command *cmd)
{
    size_t size;
    size_t total;
    uint8_t *p;
    if (cmd == NULL) {
        return 0;
    }
    size = command_size(cmd->op);
    if (size == 0u) {
        return 0;
    }
    total = frame_begin(out, cap, h, (uint8_t)SSP_TYPE_COMMAND, size);
    if (total == 0u) {
        return 0;
    }
    p = out + SSP_HEADER_SIZE;
    p[0] = cmd->op;
    if (cmd->op == SSP_CMD_SET_EEG_RATE) {
        put_u16(p + 1, cmd->eeg_rate_hz);
    } else if (cmd->op == SSP_CMD_STEER) {
        put_i16(p + 1, cmd->azimuth_deci);
        put_i16(p + 3, cmd->gain_deci_db);
    }
    return frame_end(out, total);
}

int ssp_parse_command(const uint8_t *frame, size_t len, ssp_command *out)
{
    size_t payload_len;
    size_t need;
    const uint8_t *p;
    if (frame == NULL || out == NULL || len < SSP_OVERHEAD + 1u) {
        return SSP_ERR_SHORT;
    }
    if (frame[0] != SSP_MAGIC0 || frame[1] != SSP_MAGIC1) {
        return SSP_ERR_MAGIC;
    }
    if (frame[2] != SSP_VERSION) {
        return SSP_ERR_VERSION;
    }
    payload_len = get_u16(frame + 12);
    if (payload_len == 0u || payload_len > SSP_MAX_PAYLOAD || len < SSP_OVERHEAD + payload_len) {
        return SSP_ERR_LENGTH;
    }
    if (get_u16(frame + SSP_HEADER_SIZE + payload_len) !=
        ssp_crc16(frame, SSP_HEADER_SIZE + payload_len)) {
        return SSP_ERR_CRC;
    }
    if (frame[3] != SSP_TYPE_COMMAND) {
        return SSP_ERR_TYPE;
    }
    if (frame[4] > SSP_SIDE_SINGLE) {
        return SSP_ERR_SIDE;
    }
    p = frame + SSP_HEADER_SIZE;
    need = command_size(p[0]);
    if (need == 0u) {
        return SSP_ERR_COMMAND;
    }
    if (payload_len < need) {
        return SSP_ERR_LENGTH;
    }
    memset(out, 0, sizeof *out);
    out->side = frame[4];
    out->flags = frame[5];
    out->seq = get_u16(frame + 6);
    out->timestamp_us = get_u32(frame + 8);
    out->op = p[0];
    if (out->op == SSP_CMD_SET_EEG_RATE) {
        out->eeg_rate_hz = get_u16(p + 1);
    } else if (out->op == SSP_CMD_STEER) {
        out->azimuth_deci = get_i16(p + 1);
        out->gain_deci_db = get_i16(p + 3);
    }
    return SSP_OK;
}
