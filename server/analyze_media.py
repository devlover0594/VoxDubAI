import ipaddress
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


PROVIDER_LABELS = {
    "gemini_server": "VoxDub Default (Gemini Server)",
    "gemini_custom": "Google Gemini (Custom)",
    "openai": "OpenAI",
    "openrouter": "OpenRouter",
    "groq": "Groq",
    "anthropic": "Anthropic (Claude)",
    "custom_openai": "Custom AI Provider",
}
NON_CHAT_MODEL_PATTERN = re.compile(
    r"(embedding|moderation|dall-e|imagen|whisper|transcribe|tts|speech|kokoro|orpheus|playai)",
    re.IGNORECASE,
)
GEMINI_SEGMENT_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "id": {"type": "INTEGER", "description": "Sequential segment index starting at 1"},
            "startTime": {"type": "NUMBER", "description": "Segment start time in seconds"},
            "endTime": {"type": "NUMBER", "description": "Segment end time in seconds"},
            "originalText": {"type": "STRING", "description": "Transcribed speech in the source language"},
            "translatedText": {
                "type": "STRING",
                "description": "Natural translation with syllable length proportional to segment duration",
            },
            "words": {
                "type": "ARRAY",
                "description": "Word-level timestamps for every word in translatedText",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "word": {"type": "STRING", "description": "Word from translatedText"},
                        "start": {"type": "NUMBER", "description": "Word start time in seconds"},
                        "end": {"type": "NUMBER", "description": "Word end time in seconds"},
                    },
                    "required": ["word", "start", "end"],
                },
            },
        },
        "required": ["id", "startTime", "endTime", "originalText", "translatedText", "words"],
    },
}


class AnalysisError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _validate_base_url(raw_url):
    trimmed = (raw_url or "").strip()
    if not trimmed:
        raise AnalysisError("Base URL provider wajib diisi.")

    parsed = urllib.parse.urlsplit(trimmed)
    if not parsed.scheme or not parsed.netloc:
        raise AnalysisError("Format Base URL tidak valid. Gunakan format https://...")
    if parsed.scheme != "https":
        raise AnalysisError("Base URL harus menggunakan protokol HTTPS.")
    if parsed.username or parsed.password:
        raise AnalysisError("Base URL tidak boleh menyertakan username atau password.")
    if parsed.query or parsed.fragment:
        raise AnalysisError("Base URL tidak boleh menyertakan query string atau fragment.")

    hostname = (parsed.hostname or "").lower()
    if (
        hostname == "localhost"
        or hostname.endswith(".localhost")
        or hostname.endswith(".local")
        or hostname.endswith(".internal")
    ):
        raise AnalysisError("Hostname lokal atau internal tidak diizinkan.")

    try:
        addresses = [ipaddress.ip_address(hostname)]
    except ValueError:
        try:
            addresses = [
                ipaddress.ip_address(entry[4][0])
                for entry in socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
            ]
        except OSError:
            raise AnalysisError('Hostname "{}" tidak dapat diresolusi.'.format(hostname))
        if not addresses:
            raise AnalysisError('Hostname "{}" tidak memiliki alamat IP valid.'.format(hostname))

    if any(not address.is_global for address in addresses):
        raise AnalysisError("Alamat IP privat atau loopback tidak diizinkan.")

    return trimmed.rstrip("/")


def _request(url, data=None, headers=None, timeout=45, method=None):
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    opener = urllib.request.build_opener(NoRedirectHandler())
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        try:
            body = error.read().decode("utf-8", errors="replace")
        except OSError:
            body = ""
        raise AnalysisError(
            "Provider mengembalikan error {}: {}".format(error.code, body[:260] or error.reason),
            error.code,
        )
    except urllib.error.URLError as error:
        raise AnalysisError("Gagal menghubungi provider: {}".format(error.reason))


def _json_request(url, payload, headers=None, timeout=45):
    request_headers = {"Content-Type": "application/json"}
    request_headers.update(headers or {})
    _, _, response = _request(
        url,
        json.dumps(payload).encode("utf-8"),
        request_headers,
        timeout,
    )
    try:
        return json.loads(response.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise AnalysisError("Provider mengembalikan respons JSON yang tidak valid.")


def _provider_error_status(error):
    lower = str(error).lower()
    if any(term in lower for term in ("api_key_invalid", "invalid_api_key", "permission_denied", "api key not valid", "unauthorized")) or re.search(r"\b(401|403)\b", lower):
        return 403
    if any(term in lower for term in ("resource_exhausted", "rate limit", "too many requests", "quota")) or re.search(r"\b429\b", lower):
        return 429
    if any(term in lower for term in ("entity too large", "payload too large", "request entity too large")) or re.search(r"\b413\b", lower):
        return 413
    if any(term in lower for term in ("unavailable", "high demand", "overloaded")) or re.search(r"\b503\b", lower):
        return 503
    return 500


def _map_provider_error(error, provider):
    label = PROVIDER_LABELS.get(provider, "AI Provider")
    status = _provider_error_status(error)
    if status == 403:
        if provider == "gemini_server":
            message = "API Key Gemini server tidak valid atau belum memiliki izin. Periksa pengaturan API Key di panel Settings > Secrets."
        else:
            message = "API Key {} tidak valid atau ditolak (401/403). Periksa API Key pada Pengaturan AI Provider.".format(label)
    elif status == 429:
        message = "Kuota permintaan {} sedang penuh (rate limit). Tunggu beberapa saat lalu coba lagi atau ganti model/provider lain.".format(label)
    elif status == 413:
        message = "Ukuran media terlalu besar untuk diproses sekaligus. Coba unggah file lebih kecil atau potong durasinya."
    elif status == 503:
        message = "Layanan {} sedang sibuk sementara (503). Tunggu beberapa detik lalu coba lagi.".format(label)
    else:
        message = "Gagal memproses permintaan ({}): {}".format(label, error)
    return status, message


def _resolve_model(provider, requested):
    clean = (requested or "").strip()
    if clean and clean.lower() != "auto" and not re.search(
        r"(^|[-_/])(tts|speech|kokoro|orpheus|playai|eleven|bark|voice)([-_/]|$)",
        clean,
        re.IGNORECASE,
    ):
        return clean

    defaults = {
        "gemini_server": "gemini-2.5-flash",
        "gemini_custom": "gemini-2.5-flash",
        "openai": "gpt-4o",
        "openrouter": "google/gemini-2.5-flash",
        "groq": "llama-3.3-70b-versatile",
        "anthropic": "claude-sonnet-4-5-20250929",
        "custom_openai": clean or "gpt-4o-mini",
    }
    return defaults.get(provider, "")


def _format_timestamp(seconds):
    try:
        safe = max(0.0, float(seconds))
    except (TypeError, ValueError):
        safe = 0.0
    hours = int(safe // 3600)
    minutes = int((safe % 3600) // 60)
    whole_seconds = int(safe % 60)
    millis = round((safe - int(safe)) * 1000)
    if millis == 1000:
        safe = float(int(safe) + 1)
        hours = int(safe // 3600)
        minutes = int((safe % 3600) // 60)
        whole_seconds = int(safe % 60)
        millis = 0
    return "{:02d}:{:02d}:{:02d}.{:03d}".format(hours, minutes, whole_seconds, millis)


def _parse_seconds(value):
    if isinstance(value, (int, float)) and value >= 0:
        return float(value)
    if isinstance(value, str):
        clean = value.strip().replace(",", ".")
        parts = clean.split(":")
        try:
            if len(parts) == 3:
                return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            if len(parts) == 2:
                return float(parts[0]) * 60 + float(parts[1])
            number = float(clean)
            if number >= 0:
                return number
        except ValueError:
            pass
    return 0.0


def _proportional_words(text, start, end):
    tokens = [token for token in text.strip().split() if token]
    if not tokens:
        return []
    safe_start = max(0.0, start)
    safe_end = max(safe_start + 0.1, end)
    weights = [max(1, len(token)) for token in tokens]
    total_weight = sum(weights)
    duration = safe_end - safe_start
    cursor = safe_start
    result = []
    for index, word in enumerate(tokens):
        slice_length = weights[index] / total_weight * duration
        word_start = round(cursor, 3)
        word_end = round(safe_end if index == len(tokens) - 1 else cursor + slice_length, 3)
        result.append({"word": word, "start": word_start, "end": max(word_start + 0.05, word_end)})
        cursor += slice_length
    return result


def _normalize_segments(raw_segments):
    result = []
    for index, item in enumerate(raw_segments):
        if not isinstance(item, dict):
            item = {}
        start = _parse_seconds(item.get("startTime"))
        raw_end = _parse_seconds(item.get("endTime"))
        end = raw_end if raw_end > start else start + 2.5
        words = []
        if isinstance(item.get("words"), list):
            for word in item["words"]:
                if not isinstance(word, dict) or not isinstance(word.get("word"), str):
                    continue
                word_start = max(start, min(end, _parse_seconds(word.get("start"))))
                word_end = max(word_start + 0.05, min(end, _parse_seconds(word.get("end"))))
                words.append(
                    {
                        "word": word["word"].strip(),
                        "start": round(word_start, 3),
                        "end": round(word_end, 3),
                    }
                )
        result.append(
            {
                "id": item.get("id") if isinstance(item.get("id"), (int, float)) else index + 1,
                "startTime": _format_timestamp(start),
                "endTime": _format_timestamp(end),
                "originalText": item.get("originalText", "").strip() if isinstance(item.get("originalText"), str) else "",
                "translatedText": item.get("translatedText", "").strip() if isinstance(item.get("translatedText"), str) else "",
                "words": words,
            }
        )
    return result


def _multipart(file_path, original_name, mime_type, fields):
    boundary = "----VoxDubAI{}".format(os.urandom(16).hex())
    chunks = []
    for name, value in fields:
        chunks.extend(
            [
                "--{}\r\n".format(boundary).encode(),
                'Content-Disposition: form-data; name="{}"\r\n\r\n'.format(name).encode(),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )
    filename = os.path.basename(original_name or "media.bin").replace('"', "")
    with open(file_path, "rb") as media_file:
        contents = media_file.read()
    chunks.extend(
        [
            "--{}\r\n".format(boundary).encode(),
            'Content-Disposition: form-data; name="file"; filename="{}"\r\n'.format(filename).encode(),
            "Content-Type: {}\r\n\r\n".format(mime_type or "application/octet-stream").encode(),
            contents,
            b"\r\n--{}--\r\n".format(boundary).encode(),
        ]
    )
    return b"".join(chunks), "multipart/form-data; boundary={}".format(boundary)


def _call_whisper(config, media):
    base_url = _validate_base_url(config.get("baseUrl"))
    fields = [("model", media["whisperModel"]), ("response_format", "verbose_json")]
    fields.extend([("timestamp_granularities[]", "segment"), ("timestamp_granularities[]", "word")])
    body, content_type = _multipart(
        media["filePath"], media["originalName"], media["mimeType"], fields
    )
    _, _, response = _request(
        base_url + "/audio/transcriptions",
        body,
        {
            "Authorization": "Bearer {}".format(config.get("apiKey", "")),
            "Content-Type": content_type,
        },
        timeout=60,
    )
    try:
        data = json.loads(response.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise AnalysisError("Provider mengembalikan respons transkripsi JSON yang tidak valid.")
    return {
        "text": (data.get("text") or "").strip(),
        "segments": [
            {
                "start": float(segment.get("start") or 0),
                "end": float(segment.get("end") or 0),
                "text": (segment.get("text") or "").strip(),
            }
            for segment in data.get("segments", [])
            if isinstance(segment, dict)
        ],
    }


def _call_chat(config, model, messages, json_mode=False):
    base_url = _validate_base_url(config.get("baseUrl"))
    if not config.get("apiKey"):
        raise AnalysisError("API Key provider belum diisi.")
    if not model:
        raise AnalysisError("Model AI belum dipilih. Klik Fetch Model lalu pilih model terlebih dahulu.")
    body = {"model": model, "messages": messages}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    data = _json_request(
        base_url + "/chat/completions",
        body,
        {"Authorization": "Bearer {}".format(config["apiKey"])},
    )
    try:
        return (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    except (AttributeError, IndexError, TypeError):
        return ""


def _extract_segments(raw_text):
    clean = raw_text.strip()
    clean = re.sub(r"^```(?:json)?\s*", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\s*```$", "", clean).strip()
    try:
        parsed = json.loads(clean)
    except ValueError:
        raise AnalysisError("Respons model bukan JSON yang valid.")
    if isinstance(parsed, dict) and isinstance(parsed.get("segments"), list):
        return parsed["segments"]
    if isinstance(parsed, list):
        return parsed
    raise AnalysisError("Respons model tidak berupa array segmen JSON.")


def _translate_whisper_segments(config, model, transcript_segments, source_label, target_label):
    if not transcript_segments:
        return []
    payload = [
        {
            "id": index + 1,
            "startTime": round(segment["start"], 3),
            "endTime": round(segment["end"] if segment["end"] > segment["start"] else segment["start"] + 2.5, 3),
            "originalText": segment["text"],
        }
        for index, segment in enumerate(transcript_segments)
    ]
    system = " ".join(
        [
            "You are an expert audiovisual translator and dubbing script adapter.",
            "Translate each segment into {} naturally (source hint: {}).".format(target_label, source_label),
            "CRITICAL DUBBING CONSTRAINT: Adjust phrasing and syllable length so translatedText fits comfortably inside (endTime - startTime).",
            'Return a JSON object {"segments": [{"id": number, "startTime": number, "endTime": number, "originalText": string, "translatedText": string}]} preserving exact id, startTime, endTime, and originalText.',
        ]
    )
    translated = _extract_segments(
        _call_chat(
            config,
            model,
            [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            json_mode=True,
        )
    )
    result = []
    for index, original in enumerate(payload):
        match = next(
            (segment for segment in translated if isinstance(segment, dict) and segment.get("id") == original["id"]),
            translated[index] if index < len(translated) else {},
        )
        translated_text = (
            match.get("translatedText", "").strip()
            if isinstance(match, dict) and isinstance(match.get("translatedText"), str)
            else ""
        ) or original["originalText"]
        result.append(
            {
                **original,
                "translatedText": translated_text,
                "words": _proportional_words(translated_text, original["startTime"], original["endTime"]),
            }
        )
    return result


def _gemini_request(config, model, media_part, prompt, system_instruction):
    if config["provider"] == "gemini_custom":
        api_key = config.get("apiKey", "")
        if not api_key:
            raise AnalysisError("API Key Gemini Custom belum diisi pada pengaturan AI Provider.")
        root = _validate_base_url(config.get("baseUrl") or "https://generativelanguage.googleapis.com")
        root = re.sub(r"/v1beta$", "", root, flags=re.IGNORECASE)
    else:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise AnalysisError("GEMINI_API_KEY belum dikonfigurasi di server. Atur di panel Settings > Secrets.")
        root = "https://generativelanguage.googleapis.com"

    payload = {
        "contents": [{"parts": [media_part, {"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": GEMINI_SEGMENT_SCHEMA,
        },
    }
    encoded_model = urllib.parse.quote(model, safe="-._")
    url = "{}/v1beta/models/{}:generateContent?key={}".format(
        root, encoded_model, urllib.parse.quote(api_key, safe="")
    )
    response = _json_request(url, payload, {"User-Agent": "aistudio-build"})
    try:
        parts = response["candidates"][0]["content"]["parts"]
        return "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    except (KeyError, IndexError, TypeError):
        raise AnalysisError("Format respons Gemini tidak valid.")


def _gemini_file_upload(config, media):
    api_key = (
        config.get("apiKey", "")
        if config["provider"] == "gemini_custom"
        else os.environ.get("GEMINI_API_KEY", "").strip()
    )
    root = "https://generativelanguage.googleapis.com"
    if config["provider"] == "gemini_custom":
        root = _validate_base_url(config.get("baseUrl") or root)
        root = re.sub(r"/v1beta$", "", root, flags=re.IGNORECASE)
    size = os.path.getsize(media["filePath"])
    mime_type = media["mimeType"]
    start_url = "{}/upload/v1beta/files?key={}".format(root, urllib.parse.quote(api_key, safe=""))
    _, headers, _ = _request(
        start_url,
        json.dumps({"file": {"display_name": media["originalName"]}}).encode("utf-8"),
        {
            "Content-Type": "application/json",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": mime_type,
            "User-Agent": "aistudio-build",
        },
    )
    upload_url = headers.get("x-goog-upload-url")
    if not upload_url:
        raise AnalysisError("Gemini File API tidak mengembalikan URL unggah.")
    with open(media["filePath"], "rb") as media_file:
        file_bytes = media_file.read()
    _, _, response = _request(
        upload_url,
        file_bytes,
        {
            "Content-Length": str(size),
            "Content-Type": mime_type,
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
            "User-Agent": "aistudio-build",
        },
        timeout=120,
    )
    return json.loads(response.decode("utf-8"))


def _gemini_delete_file(config, file_name):
    api_key = (
        config.get("apiKey", "")
        if config["provider"] == "gemini_custom"
        else os.environ.get("GEMINI_API_KEY", "").strip()
    )
    root = "https://generativelanguage.googleapis.com"
    if config["provider"] == "gemini_custom":
        root = _validate_base_url(config.get("baseUrl") or root)
        root = re.sub(r"/v1beta$", "", root, flags=re.IGNORECASE)
    url = "{}/v1beta/{}?key={}".format(root, file_name, urllib.parse.quote(api_key, safe=""))
    _request(url, headers={"User-Agent": "aistudio-build"}, method="DELETE")


def _analyze_gemini(config, model, media, source_label, target_label):
    uploaded_name = None
    if media["fileSize"] <= 15 * 1024 * 1024:
        with open(media["filePath"], "rb") as file_obj:
            media_part = {
                "inlineData": {
                    "mimeType": media["mimeType"],
                    "data": __import__("base64").b64encode(file_obj.read()).decode("ascii"),
                }
            }
    else:
        uploaded = _gemini_file_upload(config, media)
        file_data = uploaded.get("file", uploaded)
        uploaded_name = file_data.get("name")
        started = time.monotonic()
        try:
            while file_data.get("state") == "PROCESSING":
                if time.monotonic() - started > 90:
                    raise AnalysisError("Waktu pemrosesan file di Gemini File API habis.")
                time.sleep(2)
                file_name = file_data.get("name")
                if not file_name:
                    break
                api_key = config.get("apiKey", "") if config["provider"] == "gemini_custom" else os.environ.get("GEMINI_API_KEY", "").strip()
                root = _validate_base_url(config.get("baseUrl") or "https://generativelanguage.googleapis.com") if config["provider"] == "gemini_custom" else "https://generativelanguage.googleapis.com"
                root = re.sub(r"/v1beta$", "", root, flags=re.IGNORECASE)
                url = "{}/v1beta/{}?key={}".format(root, file_name, urllib.parse.quote(api_key, safe=""))
                file_data = _get_json(url)
            if file_data.get("state") == "FAILED":
                raise AnalysisError("Gemini File API gagal memproses file media ini.")
        except Exception:
            if uploaded_name:
                try:
                    _gemini_delete_file(config, uploaded_name)
                except AnalysisError:
                    pass
            raise
        media_part = {
            "fileData": {
                "mimeType": file_data.get("mimeType") or media["mimeType"],
                "fileUri": file_data.get("uri"),
            }
        }

    system_instruction = " ".join(
        [
            "You are an expert audiovisual translator and dubbing script adapter.",
            "Transcribe all spoken dialogue accurately into chronological segments with numeric startTime and endTime in seconds.",
            "Translate each segment into the requested target language naturally.",
            "CRITICAL DUBBING CONSTRAINT: Adjust the phrasing and syllable count of translatedText so that when spoken aloud at a normal pace, it fits proportionally inside (endTime - startTime).",
            'CRITICAL WORD-LEVEL TIMESTAMPS: Include a "words" array for EVERY word in translatedText, with exact numeric "start" and "end" timestamps in seconds strictly ordered inside [startTime, endTime].',
        ]
    )
    prompt = "Analyze this media. Source language hint: {}. Target translation language: {}. Return the structured JSON array of segments including word-level timestamps (\"words\") for translatedText.".format(source_label, target_label)
    used_model = model
    try:
        try:
            raw_text = _gemini_request(config, used_model, media_part, prompt, system_instruction)
        except AnalysisError as error:
            if config["provider"] == "gemini_server" and any(term in str(error).lower() for term in ("not_found", "404", "not found")):
                used_model = "gemini-4-hydrogen"
                raw_text = _gemini_request(config, used_model, media_part, prompt, system_instruction)
            else:
                raise
        try:
            parsed = json.loads(raw_text)
        except ValueError:
            raise AnalysisError("Format respons Gemini tidak berupa JSON yang valid.")
        if not isinstance(parsed, list):
            raise AnalysisError("Format respons Gemini tidak berupa array segmen.")
        return parsed, used_model
    finally:
        if uploaded_name:
            try:
                _gemini_delete_file(config, uploaded_name)
            except AnalysisError:
                pass


def _get_json(url):
    _, _, response = _request(url, headers={"User-Agent": "aistudio-build"})
    try:
        return json.loads(response.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise AnalysisError("Provider mengembalikan respons JSON yang tidak valid.")


def _analyze_openai_compatible(config, model, media, source_label, target_label):
    provider = config["provider"]
    if provider == "anthropic":
        raise AnalysisError(
            "Anthropic (Claude) tidak mendukung unggahan video/audio langsung. Gunakan Gemini, OpenAI, Groq, atau OpenRouter model multimodal untuk analisis media."
        )
    if not config.get("apiKey"):
        raise AnalysisError("API Key {} belum diisi.".format(PROVIDER_LABELS.get(provider, "AI Provider")))

    transcript_segments = []
    if provider in ("openai", "groq", "custom_openai"):
        try:
            whisper = _call_whisper(
                config,
                {
                    **media,
                    "whisperModel": "whisper-large-v3-turbo" if provider == "groq" else "whisper-1",
                },
            )
            transcript_segments = [
                segment for segment in whisper["segments"] if segment["text"]
            ]
            if not transcript_segments and whisper["text"]:
                transcript_segments = [{"start": 0, "end": 5, "text": whisper["text"]}]
            return _translate_whisper_segments(
                config, model, transcript_segments, source_label, target_label
            )
        except AnalysisError as error:
            if provider != "custom_openai" or error.status not in (404, 405):
                raise

    if media["fileSize"] > 15 * 1024 * 1024:
        raise AnalysisError(
            "File melebihi 15 MB untuk pengiriman inline ke {}. Gunakan file di bawah 15 MB atau pilih OpenAI/Gemini.".format(
                PROVIDER_LABELS.get(provider, "AI Provider")
            )
        )

    with open(media["filePath"], "rb") as file_obj:
        encoded = __import__("base64").b64encode(file_obj.read()).decode("ascii")
    if media["mimeType"].startswith("audio/"):
        mime_type = media["mimeType"]
        audio_format = (
            "wav" if "wav" in mime_type else "mp3" if "mp3" in mime_type or "mpeg" in mime_type else "webm"
        )
        media_content = {
            "type": "input_audio",
            "input_audio": {"data": encoded, "format": audio_format},
        }
    else:
        media_content = {
            "type": "video_url",
            "video_url": {"url": "data:{};base64,{}".format(media["mimeType"], encoded)},
        }
    prompt = " ".join(
        [
            "Analyze this media. Source language hint: {}. Target translation language: {}.".format(source_label, target_label),
            'Return ONLY a JSON object {"segments": [{"id": 1, "startTime": 0.5, "endTime": 3.5, "originalText": "...", "translatedText": "...", "words": [{"word": "...", "start": 0.5, "end": 1.0}]}]}.',
            "Ensure translatedText syllable pacing fits inside (endTime - startTime) and include word-level timestamps in words.",
        ]
    )
    raw_text = _call_chat(
        config,
        model,
        [{"role": "user", "content": [{"type": "text", "text": prompt}, media_content]}],
        json_mode=True,
    )
    segments = _extract_segments(raw_text)
    normalized = []
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            segment = {}
        normalized.append(
            {
                "id": segment.get("id") if isinstance(segment.get("id"), (int, float)) else index + 1,
                "startTime": segment.get("startTime", 0),
                "endTime": segment.get("endTime", 3),
                "originalText": segment.get("originalText") if isinstance(segment.get("originalText"), str) else "",
                "translatedText": segment.get("translatedText") if isinstance(segment.get("translatedText"), str) else "",
                "words": segment.get("words") if isinstance(segment.get("words"), list) else [],
            }
        )
    return normalized


def _analyze_candidate(config, media, source_label, target_label):
    model = _resolve_model(config.get("provider"), config.get("model"))
    if config.get("provider") in ("gemini_server", "gemini_custom"):
        segments, used_model = _analyze_gemini(config, model, media, source_label, target_label)
    else:
        segments = _analyze_openai_compatible(config, model, media, source_label, target_label)
        used_model = model
    return _normalize_segments(segments), used_model


def analyze(payload):
    candidates = payload.get("candidates") or []
    if not candidates:
        raise AnalysisError("Konfigurasi AI belum tersedia.")
    candidates = candidates[:7]
    errors = []
    media = payload["media"]
    for index, candidate in enumerate(candidates):
        provider = candidate.get("provider", "gemini_server")
        try:
            segments, used_model = _analyze_candidate(
                candidate,
                media,
                payload["sourceLabel"],
                payload["targetLabel"],
            )
            return {
                "ok": True,
                "segments": segments,
                "usedModel": used_model,
                "usedProvider": PROVIDER_LABELS.get(provider, "AI Provider"),
                "fallbackUsed": index > 0,
                "attemptCount": index + 1,
            }
        except Exception as error:
            status, message = _map_provider_error(error, provider)
            errors.append({"status": status, "message": message, "label": PROVIDER_LABELS.get(provider, "AI Provider")})

    retryable = any(error["status"] in (429, 503) for error in errors)
    all_client_or_auth = bool(errors) and all(error["status"] in (400, 401, 403) for error in errors)
    final_status = 429 if retryable else 403 if all_client_or_auth else errors[0]["status"] if errors else 500
    if len(errors) <= 1:
        message = errors[0]["message"] if errors else "Gagal memproses permintaan AI."
    else:
        details = " | ".join(
            "[#{} {}: {}]".format(index + 1, error["label"], error["message"])
            for index, error in enumerate(errors)
        )
        message = "Semua {} konfigurasi AI gagal ({})".format(len(errors), details)
    return {"ok": False, "error": message, "httpStatus": final_status}


def main():
    try:
        payload = json.load(sys.stdin)
        result = analyze(payload)
    except Exception as error:
        result = {"ok": False, "error": str(error), "httpStatus": getattr(error, "status", None) or 500}
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
