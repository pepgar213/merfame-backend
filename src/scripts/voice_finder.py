import torch
import torchaudio
from pydub import AudioSegment
import numpy as np
import warnings
import os
import json
import sys
import time

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
warnings.filterwarnings("ignore")

# Configuración de parámetros optimizados
TARGET_SR = 16000
THRESHOLD = 0.70  # Reducido para mayor sensibilidad
MIN_SEGMENT_DURATION = 0.2  # Reducido para capturar segmentos más cortos
MIN_SILENCE_DURATION = 0.3  # Reducido para unir segmentos más cercanos
SEGMENT_DURATION = 3  # Segmentos más cortos para mejor resolución
SEGMENT_OVERLAP = 0.5  # Mayor solapamiento para no perder transiciones
CONSECUTIVE_VOICE_THRESHOLD = 1  # Más permisivo con segmentos aislados
MIN_TOTAL_VOICE_DURATION = 0.8  # Reducido para capturar audio con poca voz

# Nuevos parámetros para mejor precisión
ENERGY_THRESHOLD_RATIO = 0.05  # Más bajo para capturar voz suave
VOICE_FREQ_MIN = 80  # Frecuencia mínima de voz (Hz)
VOICE_FREQ_MAX = 400  # Frecuencia máxima de voz fundamental (Hz)

# Variable global para almacenar el modelo cargado
vad_model = None
vad_utils = None

def load_vad_model():
    """Carga el modelo Silero VAD una sola vez"""
    global vad_model, vad_utils
    
    if vad_model is None:
        print("Cargando modelo Silero VAD por primera vez...")
        start_time = time.time()
        vad_model, vad_utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            trust_repo=True,
            verbose=False
        )
        print(f"Modelo cargado en {time.time() - start_time:.2f} segundos")
    
    return vad_model, vad_utils

def load_and_preprocess_audio(audio_path, target_sr=TARGET_SR):
    """Carga el audio y lo convierte al formato requerido"""
    audio = AudioSegment.from_file(audio_path)
    audio = audio.set_channels(1).set_frame_rate(target_sr)
    samples = np.array(audio.get_array_of_samples())
    samples = samples.astype(np.float32) / (2**15)
    return samples, target_sr, len(audio) / 1000  # samples, sample_rate, duration_seconds

def apply_energy_filter(audio_samples, sr, threshold_ratio=ENERGY_THRESHOLD_RATIO):
    """Filtro basado en energía mejorado"""
    frame_length = int(0.025 * sr)  # 25ms frames
    hop_length = int(0.010 * sr)    # 10ms hop
    
    # Calcular energía en ventanas deslizantes
    energies = []
    for i in range(0, len(audio_samples) - frame_length, hop_length):
        frame = audio_samples[i:i + frame_length]
        energy = np.mean(np.abs(frame))
        energies.append(energy)
    
    if not energies:
        return False
    
    # Usar percentil en lugar de máximo para evitar picos ruidosos
    energy_threshold = np.percentile(energies, 75) * threshold_ratio
    return np.mean(energies) > energy_threshold

def apply_spectral_filter(audio_samples, sr):
    """Filtro espectral para detectar características de voz"""
    try:
        # Calcular FFT
        fft = np.fft.rfft(audio_samples)
        freqs = np.fft.rfftfreq(len(audio_samples), 1/sr)
        magnitudes = np.abs(fft)
        
        # Buscar picos en el rango de frecuencia de voz
        voice_band_mask = (freqs >= VOICE_FREQ_MIN) & (freqs <= VOICE_FREQ_MAX)
        voice_magnitudes = magnitudes[voice_band_mask]
        
        if len(voice_magnitudes) == 0:
            return False
        
        # Verificar si hay energía significativa en las frecuencias de voz
        voice_energy_ratio = np.sum(voice_magnitudes) / np.sum(magnitudes)
        return voice_energy_ratio > 0.1  # Al menos 10% de energía en banda vocal
    
    except Exception:
        return True  # Si falla el análisis espectral, proceder con el análisis normal

def process_audio_segments(model, utils, audio_samples, sr, total_duration, segment_duration=SEGMENT_DURATION, overlap=SEGMENT_OVERLAP):
    """Procesa el audio en segmentos más pequeños con mejoras en la detección"""
    (get_speech_timestamps, _, _, _, _) = utils
    
    samples_per_segment = int(segment_duration * sr)
    overlap_samples = int(samples_per_segment * overlap)
    step_samples = samples_per_segment - overlap_samples
    total_samples = len(audio_samples)
    
    all_speech_segments = []
    segment_voice_flags = []
    
    start_sample = 0
    segment_index = 0
    
    while start_sample < total_samples:
        end_sample = min(start_sample + samples_per_segment, total_samples)
        segment = audio_samples[start_sample:end_sample]
        
        # Aplicar múltiples filtros
        has_sufficient_energy = apply_energy_filter(segment, sr)
        has_voice_characteristics = apply_spectral_filter(segment, sr)
        
        if has_sufficient_energy and has_voice_characteristics:
            audio_tensor = torch.from_numpy(segment).unsqueeze(0)
            
            # Probar con diferentes thresholds para mayor precisión
            speech_timestamps = get_speech_timestamps(
                audio_tensor, 
                model, 
                sampling_rate=sr, 
                threshold=THRESHOLD
            )
            
            # Si no se detecta voz con el threshold normal, intentar con uno más bajo
            if not speech_timestamps:
                speech_timestamps = get_speech_timestamps(
                    audio_tensor, 
                    model, 
                    sampling_rate=sr, 
                    threshold=THRESHOLD * 0.8  # Threshold más bajo
                )
            
            # Filtrar segmentos muy cortos
            filtered_timestamps = []
            for seg in speech_timestamps:
                duration = (seg['end'] - seg['start']) / sr
                if duration >= MIN_SEGMENT_DURATION:
                    filtered_timestamps.append(seg)
            
            segment_start_time = start_sample / sr
            for segment_info in filtered_timestamps:
                start_sec = segment_info['start'] / sr + segment_start_time
                end_sec = segment_info['end'] / sr + segment_start_time
                all_speech_segments.append({
                    'start': start_sec, 
                    'end': end_sec,
                    'segment_index': segment_index,
                    'duration': end_sec - start_sec
                })
            
            voice_detected = len(filtered_timestamps) > 0
        else:
            voice_detected = False
        
        segment_voice_flags.append(voice_detected)
        start_sample += step_samples
        segment_index += 1
    
    return all_speech_segments, segment_voice_flags

def filter_consecutive_voice(segments, voice_flags, min_consecutive=CONSECUTIVE_VOICE_THRESHOLD):
    """Filtro mejorado para segmentos consecutivos"""
    if not segments:
        return []
    
    # Agrupar segmentos por proximidad temporal en lugar de por índice
    segments.sort(key=lambda x: x['start'])
    
    if len(segments) == 1:
        return segments  # Si solo hay un segmento, mantenerlo
    
    # Agrupar segmentos que están cerca temporalmente
    merged_groups = []
    current_group = [segments[0]]
    
    for i in range(1, len(segments)):
        current_segment = segments[i]
        last_segment = current_group[-1]
        
        # Si los segmentos están cerca (menos de 1 segundo), agruparlos
        if current_segment['start'] - last_segment['end'] <= 1.0:
            current_group.append(current_segment)
        else:
            merged_groups.append(current_group)
            current_group = [current_segment]
    
    merged_groups.append(current_group)
    
    # Filtrar grupos que tienen suficiente duración total
    filtered_segments = []
    for group in merged_groups:
        total_duration = sum(seg['duration'] for seg in group)
        if total_duration >= MIN_TOTAL_VOICE_DURATION * 0.5:  # Más permisivo con grupos
            filtered_segments.extend(group)
    
    return filtered_segments

def merge_close_segments(segments, gap_threshold=MIN_SILENCE_DURATION):
    """Une segmentos de voz que están muy cercanos entre sí"""
    if not segments:
        return []
    
    segments.sort(key=lambda x: x['start'])
    merged = [segments[0].copy()]
    
    for current in segments[1:]:
        last = merged[-1]
        gap = current['start'] - last['end']
        
        # Si el gap es pequeño, unir los segmentos
        if gap <= gap_threshold:
            last['end'] = max(last['end'], current['end'])
            last['duration'] = last['end'] - last['start']
        else:
            merged.append(current.copy())
    
    return merged

def calculate_total_voice_duration(segments):
    """Calcula la duración total de voz detectada"""
    return sum(seg['end'] - seg['start'] for seg in segments)

def validate_voice_segments(segments, total_audio_duration):
    """Valida y filtra segmentos de voz detectados"""
    if not segments:
        return []
    
    # Filtrar segmentos que son demasiado cortos
    valid_segments = [seg for seg in segments if seg['duration'] >= MIN_SEGMENT_DURATION]
    
    # Filtrar segmentos que están en los extremos del audio (posible ruido)
    valid_segments = [seg for seg in valid_segments 
                     if seg['start'] > 0.1 and seg['end'] < total_audio_duration - 0.1]
    
    return valid_segments

def main(audio_path, output_path):
    print(f"Iniciando procesamiento de: {audio_path}")
    start_time = time.time()
    
    # Cargar modelo (solo una vez)
    model, utils = load_vad_model()
    
    print("Cargando y preprocesando audio...")
    audio_load_time = time.time()
    samples, sr, total_duration = load_and_preprocess_audio(audio_path)
    print(f"Audio cargado en {time.time() - audio_load_time:.2f} segundos")
    
    print(f"Duración total del audio: {total_duration:.2f} segundos")
    print("Procesando audio en segmentos con solapamiento...")
    
    processing_time = time.time()
    speech_segments, voice_flags = process_audio_segments(model, utils, samples, sr, total_duration)
    print(f"Procesamiento de audio completado en {time.time() - processing_time:.2f} segundos")
    print(f"Segmentos crudos detectados: {len(speech_segments)}")
    
    # Aplicar filtros y validaciones mejoradas
    print("Aplicando filtros anti-falsos positivos...")
    
    # Validar segmentos
    validated_segments = validate_voice_segments(speech_segments, total_duration)
    
    # Filtrar por segmentos consecutivos
    filtered_segments = filter_consecutive_voice(validated_segments, voice_flags)
    
    # Unir segmentos cercanos
    merged_segments = merge_close_segments(filtered_segments)
    
    # Verificar duración total mínima
    total_voice_duration = calculate_total_voice_duration(merged_segments)
    
    if merged_segments and total_voice_duration >= MIN_TOTAL_VOICE_DURATION:
        merged_segments.sort(key=lambda x: x['start'])
        first_voice_second = merged_segments[0]['start']
        
        # Escribir el resultado en un archivo JSON
        result = {
            "first_voice_second": first_voice_second,
            "total_voice_duration": total_voice_duration,
            "voice_segments_count": len(merged_segments),
            "audio_duration": total_duration
        }
        
        with open(output_path, 'w') as f:
            json.dump(result, f, indent=2)
        
        print(f"Primera voz detectada en: {first_voice_second:.3f} segundos")
        print(f"Duración total de voz: {total_voice_duration:.2f} segundos")
        print(f"Segmentos de voz detectados: {len(merged_segments)}")
        print(f"Resultados guardados en: {output_path}")
    else:
        # Si no se detecta voz suficiente, se escribe un valor por defecto
        result = {
            "first_voice_second": 0,
            "total_voice_duration": 0,
            "voice_segments_count": 0,
            "audio_duration": total_duration
        }
        
        with open(output_path, 'w') as f:
            json.dump(result, f, indent=2)
        
        if merged_segments:
            print(f"Voz detectada pero insuficiente ({total_voice_duration:.2f}s < {MIN_TOTAL_VOICE_DURATION}s)")
        else:
            print("No se detectó voz en el audio")
    
    print(f"Procesamiento total completado en {time.time() - start_time:.2f} segundos")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Uso: python voice_finder.py <audio_path> <output_json_path>")
        sys.exit(1)
    
    audio_path = sys.argv[1]
    output_path = sys.argv[2]
    main(audio_path, output_path)