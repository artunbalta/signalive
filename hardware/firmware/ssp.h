/*
 * SSP v0, the Signalive Sensor Protocol: the reference encoder for earbud
 * firmware. See hardware/PROTOCOL.md for the wire format and the reasons
 * behind it.
 *
 * The earbud only samples, timestamps and packetizes; every decision is made
 * on the phone. So this is the whole of the protocol the firmware needs: one
 * encoder per frame type it sends, and one parser for the commands the phone
 * writes back.
 *
 * C99, no dynamic allocation, no library beyond stdint.h, stddef.h and
 * string.h. Every encoder writes one complete frame (header, payload, CRC)
 * into a buffer the caller owns and returns the frame's length in bytes, or 0
 * when the buffer is too small or an argument is out of range. One frame is
 * one BLE notification.
 */
#ifndef SSP_H
#define SSP_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* GATT: one service per earbud, frames notified on one characteristic,
 * commands written to the other. One random 128 bit base, numbered in its
 * second 16 bits. SSP_UUID_LE(n) is UUID n as the 16 little endian bytes most
 * BLE stacks take for a GATT table. */
#define SSP_SERVICE_UUID "5a9a0001-282b-483b-bc7c-5ef1d6777a4d"
#define SSP_FRAMES_UUID "5a9a0002-282b-483b-bc7c-5ef1d6777a4d"   /* notify */
#define SSP_COMMANDS_UUID "5a9a0003-282b-483b-bc7c-5ef1d6777a4d" /* write */
#define SSP_UUID_LE(n)                                                                     \
    {                                                                                      \
        0x4d, 0x7a, 0x77, 0xd6, 0xf1, 0x5e, 0x7c, 0xbc, 0x3b, 0x48, 0x2b, 0x28, (n), 0x00, \
            0x9a, 0x5a                                                                     \
    }

#define SSP_MAGIC0 0x53u /* 'S' */
#define SSP_MAGIC1 0x4Cu /* 'L' */
#define SSP_VERSION 0u

/* Header, then payload, then a CRC-16 over both. */
#define SSP_HEADER_SIZE 14u
#define SSP_CRC_SIZE 2u
#define SSP_OVERHEAD (SSP_HEADER_SIZE + SSP_CRC_SIZE)
/* No v0 frame is longer than this on any transport. */
#define SSP_MAX_FRAME 1024u
#define SSP_MAX_PAYLOAD (SSP_MAX_FRAME - SSP_OVERHEAD)

/* The BLE link the protocol is sized for: ATT MTU 247 (data length
 * extension), so a notification carries at most 244 bytes. */
#define SSP_BLE_MTU 247u
#define SSP_BLE_MAX_FRAME (SSP_BLE_MTU - 3u)

#define SSP_MAX_CHANNELS 32u
#define SSP_LABEL_SIZE 4u
#define SSP_MAX_TALKERS 8u
#define SSP_INT24_MAX 8388607L
#define SSP_INT24_MIN (-8388608L)
/* AUDIO_ENV frames always carry envelopes at this rate. */
#define SSP_ENV_RATE_HZ 64u
/* IMU quaternion components: 1.0 is this many counts. */
#define SSP_QUAT_ONE 16384

/* Frame types. */
#define SSP_TYPE_HELLO 0x01u
#define SSP_TYPE_EEG 0x02u
#define SSP_TYPE_IMU 0x03u
#define SSP_TYPE_EVENT 0x04u
#define SSP_TYPE_COMMAND 0x05u /* phone to earbud */
#define SSP_TYPE_AUDIO_ENV 0x06u

/* Sides. Each earbud is its own peripheral; 2 is a device that is both, such
 * as a dev kit. In a command, 2 means whichever earbud receives it. */
#define SSP_SIDE_LEFT 0u
#define SSP_SIDE_RIGHT 1u
#define SSP_SIDE_SINGLE 2u

/* Header flags. */
#define SSP_FLAG_STREAM_START 0x01u /* first frame after streaming (re)starts */
#define SSP_FLAG_LEAD_OFF 0x02u     /* an electrode is off; see EVENT lead off */
#define SSP_FLAG_DEVICE_DROP 0x04u  /* the earbud itself dropped frames before this one */
#define SSP_FLAG_SIMULATED 0x80u    /* made by an emulator, never by hardware */

/* EVENT codes. */
#define SSP_EVENT_BUTTON 0x01u   /* value: 1 press, 2 double press, 3 long press */
#define SSP_EVENT_WEAR 0x02u     /* value: 1 in the ear, 0 out */
#define SSP_EVENT_BATTERY 0x03u  /* value: percent */
#define SSP_EVENT_LEAD_OFF 0x04u /* value: bit i set when channel i has lost contact */

/* HOST COMMAND operations. */
#define SSP_CMD_START 0x01u
#define SSP_CMD_STOP 0x02u
#define SSP_CMD_SET_EEG_RATE 0x03u /* u16 rate in Hz */
#define SSP_CMD_STEER 0x04u        /* int16 azimuth (0.1 degree), int16 gain (0.1 dB) */
#define SSP_CMD_HELLO 0x05u        /* send a HELLO now */

/* ssp_parse_command results. */
#define SSP_OK 0
#define SSP_ERR_SHORT (-1)   /* fewer bytes than a header and CRC */
#define SSP_ERR_MAGIC (-2)
#define SSP_ERR_VERSION (-3)
#define SSP_ERR_TYPE (-4)    /* a valid frame, but not a command */
#define SSP_ERR_LENGTH (-5)  /* payload shorter than its operation needs, or truncated */
#define SSP_ERR_CRC (-6)
#define SSP_ERR_SIDE (-7)
#define SSP_ERR_COMMAND (-8) /* unknown operation */

/* The header fields an encoder takes from the caller. The firmware keeps one
 * seq counter per earbud across every frame type and increments it for each
 * frame, including frames it had to drop. The timestamp is the earbud's own
 * microsecond clock at the frame's first sample; it wraps every 71.6 minutes
 * and the phone unwraps it. */
typedef struct {
    uint8_t side;
    uint8_t flags;
    uint16_t seq;
    uint32_t timestamp_us;
} ssp_header;

/* HELLO: who the earbud is and how to read its samples. Sent when streaming
 * starts, when the phone asks, and after the configuration changes. */
typedef struct {
    uint8_t fw_major;
    uint8_t fw_minor;
    uint8_t fw_patch;
    uint8_t channel_count; /* 1 to SSP_MAX_CHANNELS */
    uint8_t device_id[8];
    /* ASCII, NUL padded; a 4 character label has no terminator. */
    char labels[SSP_MAX_CHANNELS][SSP_LABEL_SIZE];
    uint16_t eeg_rate_hz;
    float nv_per_lsb; /* ADC nanovolts per count, referred to the electrode */
    uint16_t imu_rate_hz; /* 0 when there is no IMU */
    uint8_t battery_percent; /* 0 to 100, 255 when unknown */
} ssp_hello;

/* One IMU sample, already rotated into the head frame (x forward, y right,
 * z down), so yaw grows when the head turns right. */
typedef struct {
    int16_t accel[3]; /* milli g */
    int16_t gyro[3];  /* 0.1 degree per second */
    int16_t quat[4];  /* w, x, y, z; SSP_QUAT_ONE is 1.0; head frame to world */
} ssp_imu_sample;

/* A decoded host command. Fields an operation does not use are zero. */
typedef struct {
    uint8_t side; /* the side the phone addressed */
    uint8_t flags;
    uint16_t seq;
    uint32_t timestamp_us; /* the phone's clock, informational */
    uint8_t op;
    uint16_t eeg_rate_hz; /* SET_EEG_RATE */
    int16_t azimuth_deci; /* STEER: 0.1 degree, 0 ahead, positive to the right */
    int16_t gain_deci_db; /* STEER: 0.1 dB of emphasis for that direction */
} ssp_command;

/* CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no
 * reflection, no final xor. ssp_crc16("123456789") is 0x29B1. */
uint16_t ssp_crc16(const uint8_t *data, size_t len);

/* Largest sample count per frame that fits a notification of max_frame bytes
 * (SSP_BLE_MAX_FRAME for the assumed link). 0 when none fits. */
uint8_t ssp_max_eeg_samples(uint8_t channels, size_t max_frame);
uint8_t ssp_max_imu_samples(size_t max_frame);
uint8_t ssp_max_env_samples(uint8_t talkers, size_t max_frame);

size_t ssp_encode_hello(uint8_t *out, size_t cap, const ssp_header *h, const ssp_hello *hello);

/* samples holds n * channels raw ADC counts interleaved by sample (sample 0
 * channel 0, sample 0 channel 1, ...). Counts outside the int24 range are
 * saturated. */
size_t ssp_encode_eeg(uint8_t *out, size_t cap, const ssp_header *h, const int32_t *samples,
                      uint8_t n, uint8_t channels);

size_t ssp_encode_imu(uint8_t *out, size_t cap, const ssp_header *h, const ssp_imu_sample *samples,
                      uint8_t n);

size_t ssp_encode_event(uint8_t *out, size_t cap, const ssp_header *h, uint8_t code, uint32_t value);

/* azimuth_deci[k] is where talker k is, in 0.1 degree; env holds n * talkers
 * envelope values interleaved by sample, at SSP_ENV_RATE_HZ. */
size_t ssp_encode_audio_env(uint8_t *out, size_t cap, const ssp_header *h,
                            const int16_t *azimuth_deci, const uint16_t *env, uint8_t n,
                            uint8_t talkers);

/* The phone's side of a command; here for host simulators and tests. */
size_t ssp_encode_command(uint8_t *out, size_t cap, const ssp_header *h, const ssp_command *cmd);

/* Decodes one command frame as written by the phone (one frame per write).
 * Returns SSP_OK and fills out, or a negative SSP_ERR_ code. An earbud acts
 * on a command addressed to its own side or to SSP_SIDE_SINGLE. Payload bytes
 * past what an operation needs are ignored, so newer phones can extend a
 * command without breaking older earbuds. */
int ssp_parse_command(const uint8_t *frame, size_t len, ssp_command *out);

#ifdef __cplusplus
}
#endif

#endif /* SSP_H */
