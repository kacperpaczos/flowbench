"""Dekoder formatu `flatted`, ktorym n8n serializuje execution_data.data.

Format: tablica wartosci; kazdy string WEWNATRZ kontenera jest indeksem do tej
tablicy (prawdziwe stringi leza w niej jako osobne wpisy). Liczby, bool i null
sa doslowne. Cykle sa mozliwe, wiec rewitalizacja jest memoizowana.
"""
import json


def unflatten(flat):
    known = {}

    def resolve(v):
        if isinstance(v, str):
            return revive(int(v))
        return v

    def revive(idx):
        if idx in known:
            return known[idx]
        val = flat[idx]
        if isinstance(val, list):
            out = []
            known[idx] = out
            out.extend(resolve(v) for v in val)
            return out
        if isinstance(val, dict):
            out = {}
            known[idx] = out
            for k, v in val.items():
                out[k] = resolve(v)
            return out
        known[idx] = val
        return val

    return revive(0)


def parse(text):
    return unflatten(json.loads(text))
