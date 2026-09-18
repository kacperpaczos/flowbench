#!/usr/bin/env python3
"""Ekstrakcja fixture migracyjnych ze spojnej migawki bazy n8n.

Wejscie : migawka `database.sqlite` zrobiona natywnym online-backupem SQLite
          (patrz fixtures/README.md, sekcja "Jak odtworzyc ekstrakcje").
Wyjscie : drzewo `fixtures/` + `fixtures/MANIFEST.json`.

Skrypt jest WYLACZNIE czytajacy wobec bazy: polaczenie otwiera sie z `mode=ro`.
Nie dotyka zywego wolumenu `n8niframe_n8n_data` — pracuje na kopii.

Uzycie:
    python3 fixtures/_narzedzia/ekstrakcja.py <sciezka-do-migawki> [<katalog-fixtures>]
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import flatted  # noqa: E402

# --- co wyciagamy -----------------------------------------------------------

# Cztery procesy DO-ODTWORZENIA wedlug docs/rejestr-workflow.md §2 i §4.
# `wykonanieWzorcowe` to wykonanie, z ktorego bierzemy wejscie i oczekiwane wyjscie:
# zawsze NAJNOWSZE wykonanie danego workflow, czyli to zgodne z biezaca definicja.
PROCESY = [
    {
        "dag": "status-ok",
        "workflowId": "gnzjOf2qHJoEPeGo",
        "wykonanieWzorcowe": 12,
        "wezelWejscia": "Set Status",
        "sekcjaRejestru": "§4.1",
    },
    {
        "dag": "demo-mcp-wartosc-zamowienia",
        "workflowId": "ag3nCPjnADFqUADE",
        "wykonanieWzorcowe": 3,
        "wezelWejscia": "Pozycja zamowienia",
        "sekcjaRejestru": "§4.2",
    },
    {
        "dag": "lista-produktow-suma-zamowienia",
        "workflowId": "UQeWUmSDcg9gKXXY",
        "wykonanieWzorcowe": 4,
        "wezelWejscia": "Lista produktow",
        "sekcjaRejestru": "§4.3",
    },
    {
        "dag": "premie-od-pensji",
        "workflowId": "aEUUAnNsUr7LJIyr",
        "wykonanieWzorcowe": 11,
        "wezelWejscia": "Dane pracownikow",
        "sekcjaRejestru": "§4.4",
    },
]

# Dwa ARTEFAKTY-HISTORYCZNE (rejestr §2) — sama definicja, bez wejscia/wyjscia.
ARTEFAKTY = [
    {
        "katalog": "prototyp-iframe-test-ICRY74rH9w6xbTqr",
        "workflowId": "ICRY74rH9w6xbTqr",
        "powod": "jedyny slad wykonania silnika PRZED podlaczeniem MCP (wykonanie #1)",
    },
    {
        "katalog": "srednia-temperatura-trzech-miast-rnfu7SOGxjqaUbYH",
        "workflowId": "rnfu7SOGxjqaUbYH",
        "powod": "slad, ze czat radzil sobie poza domena handlowa; nazwa = przypadek testowy "
                 "ograniczenia identyfikatorow Dagu (rejestr §4.0a)",
    },
]

# Workflow, dla ktorego zachowujemy pelna historie edycji przez czat (rejestr §1.1).
PREMIE_ID = "aEUUAnNsUr7LJIyr"

# Kolumny `workflow_entity`, ktore skladaja sie na definicje. Kolejnosc jest stala,
# zeby ekstrakcja byla powtarzalna bajt w bajt.
KOLUMNY_DEFINICJI = [
    "id", "name", "active", "nodes", "connections", "settings", "staticData",
    "pinData", "versionId", "triggerCount", "meta", "parentFolderId",
    "createdAt", "updatedAt", "isArchived", "versionCounter", "description",
    "activeVersionId", "nodeGroups", "sourceWorkflowId",
]
# Te kolumny trzymaja JSON jako tekst — rozpakowujemy je do struktury.
KOLUMNY_JSON = {"nodes", "connections", "settings", "staticData", "pinData",
                "meta", "nodeGroups"}

# Pola migawki wykonania, ktorych NIE wynosimy do repozytorium (rejestr: zakaz sekretow).
POLA_POMINIETE = {
    "execution_data.data → resumeToken":
        "64-znakowy token wznowienia wykonania; material sesyjny silnika n8n, "
        "bez wartosci dla odtworzenia procesu",
}

# Wzorce, ktorymi skrypt sam sie pilnuje przed zapisem plikow fixture.
WZORCE_SEKRETOW = [
    re.compile(r"resumeToken", re.I),
    re.compile(r"encryptionKey", re.I),
    re.compile(r"\$2[aby]\$\d{2}\$"),          # hash bcrypt
    re.compile(r"\b[0-9a-f]{64}\b"),           # 64-hex: token / suma ze zrodla
]

# MANIFEST.json z zalozenia zawiera sumy sha256 (64-hex) i nazywa pole pominiete
# (`resumeToken`) — jedno i drugie to opis, nie sekret. Zostaje zakaz materialu,
# ktory sekretem jest naprawde.
WZORCE_SEKRETOW_MANIFEST = [
    re.compile(r"\$2[aby]\$\d{2}\$"),          # hash bcrypt
    re.compile(r"encryptionKey", re.I),
]

ZNACZNIK = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# --- pomocnicze -------------------------------------------------------------

def _zapisz_json(sciezka: str, obiekt, wzorce=None) -> None:
    os.makedirs(os.path.dirname(sciezka), exist_ok=True)
    tekst = json.dumps(obiekt, indent=2, ensure_ascii=False) + "\n"
    for wzorzec in (WZORCE_SEKRETOW if wzorce is None else wzorce):
        trafienie = wzorzec.search(tekst)
        if trafienie:
            raise SystemExit(
                f"STOP: {sciezka} zawiera material pasujacy do wzorca sekretu "
                f"{wzorzec.pattern!r}: {trafienie.group(0)[:16]}…"
            )
    with open(sciezka, "w", encoding="utf-8") as f:
        f.write(tekst)


def _sha256(sciezka: str) -> str:
    h = hashlib.sha256()
    with open(sciezka, "rb") as f:
        for kawalek in iter(lambda: f.read(65536), b""):
            h.update(kawalek)
    return h.hexdigest()


def _typ(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array"
    return "object"


def _zbierz(v, sciezka, wynik, wartosc_dla):
    """Rekurencyjnie zbiera wartosci do mapy sciezka -> zbior zaobserwowanych wartosci."""
    w = wartosc_dla(v)
    if w is not None and sciezka:
        wynik.setdefault(sciezka, set()).add(w)
    if isinstance(v, dict):
        for k in v:
            _zbierz(v[k], f"{sciezka}.{k}" if sciezka else k, wynik, wartosc_dla)
    elif isinstance(v, list):
        for el in v:
            _zbierz(el, f"{sciezka}[]", wynik, wartosc_dla)
    return wynik


def _splaszcz(zebrane: dict) -> dict:
    """Zbior jednoelementowy -> sama wartosc; wiekszy -> posortowana lista.

    Rozne elementy tablicy moga miec rozne typy albo rozna precyzje; taka
    rozbieznosc ma byc widoczna w fixture, a nie zamieciona pod dywan.
    """
    out = {}
    for sciezka in sorted(zebrane):
        wartosci = sorted(zebrane[sciezka], key=str)
        out[sciezka] = wartosci[0] if len(wartosci) == 1 else wartosci
    return out


def szkielet_typow(v) -> dict:
    """Plaska mapa sciezka -> typ JSON. Elementy tablic pod `[]`.

    Sluzy do maszynowego porownania fixture z migawka: zgodnosc pol, typow
    i rozroznienia integer/number (a przez to precyzji zapisu liczb).
    """
    return _splaszcz(_zbierz(v, "", {}, _typ))


def _precyzja(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    tekst = repr(v)
    return len(tekst.split(".")[1]) if "." in tekst else 0


def precyzja_liczb(v) -> dict:
    """Mapa sciezka -> liczba cyfr po przecinku w zapisie dziesietnym."""
    return _splaszcz(_zbierz(v, "", {}, _precyzja))


def _elementy(runs, nazwa_wezla):
    """Zwraca (payloady json, koperty pairedItem) ostatniego przebiegu wezla."""
    przebieg = runs[nazwa_wezla][-1]
    galezie = przebieg.get("data", {}).get("main", [[]])
    pozycje = galezie[0] if galezie else []
    return ([p["json"] for p in pozycje],
            [p.get("pairedItem") for p in pozycje],
            przebieg)


# --- ekstrakcja -------------------------------------------------------------

def definicja(con, workflow_id: str) -> dict:
    kol = ", ".join(f'"{k}"' for k in KOLUMNY_DEFINICJI)
    wiersz = con.execute(
        f"SELECT {kol} FROM workflow_entity WHERE id = ?", (workflow_id,)
    ).fetchone()
    if wiersz is None:
        raise SystemExit(f"STOP: brak workflow {workflow_id} w migawce")
    out = {}
    for nazwa, wartosc in zip(KOLUMNY_DEFINICJI, wiersz):
        if nazwa in KOLUMNY_JSON and isinstance(wartosc, str):
            out[nazwa] = json.loads(wartosc)
        elif nazwa in ("active", "isArchived"):
            out[nazwa] = bool(wartosc)
        else:
            out[nazwa] = wartosc
    return out


def zrodlo_definicji(workflow_id: str) -> dict:
    return {
        "typ": "baza",
        "tabela": "workflow_entity",
        "kolumny": list(KOLUMNY_DEFINICJI),
        "wiersz": f"id = '{workflow_id}'",
        "uwaga": "kolumny trzymajace JSON jako tekst (nodes, connections, settings, "
                 "staticData, pinData, meta, nodeGroups) rozpakowane do struktury; "
                 "reszta bez zmian",
    }


def zbuduj_proces(con, proces: dict, katalog: str, pliki: list) -> None:
    wid = proces["workflowId"]
    eid = proces["wykonanieWzorcowe"]
    baza = os.path.join(katalog, proces["dag"])

    # --- definicja ---
    d = definicja(con, wid)
    sciezka = os.path.join(baza, "definicja-n8n.json")
    _zapisz_json(sciezka, d)
    pliki.append((sciezka, zrodlo_definicji(wid)))

    # --- migawka wykonania ---
    wiersz = con.execute(
        "SELECT e.id, e.status, e.mode, e.startedAt, e.stoppedAt, e.workflowVersionId, d.data "
        "FROM execution_entity e JOIN execution_data d ON d.executionId = e.id "
        "WHERE e.id = ?", (eid,)
    ).fetchone()
    _, status, tryb, start, stop, wersja, dane_txt = wiersz
    dane = flatted.parse(dane_txt)
    runs = dane["resultData"]["runData"]
    ostatni = dane["resultData"]["lastNodeExecuted"]

    wezly_def = {n["name"]: n for n in d["nodes"]}
    wyzwalacz = next(n["name"] for n in d["nodes"]
                     if n["type"] == "n8n-nodes-base.manualTrigger")

    kontekst = {
        "workflowId": wid,
        "nazwaN8n": d["name"],
        "dagRoboczy": proces["dag"],
        "wykonanie": eid,
        "statusWykonania": status,
        "trybWykonania": tryb,
        "rozpoczete": start,
        "zakonczone": stop,
        "versionIdWykonania": wersja,
        "versionIdBiezacy": d["versionId"],
        "wykonanieZgodneZBiezacaDefinicja": wersja == d["versionId"],
        "sekcjaRejestru": proces["sekcjaRejestru"],
        "znacznikEkstrakcji": ZNACZNIK,
    }

    # --- wejscie ---
    nazwa_wej = proces["wezelWejscia"]
    payloady, koperty, przebieg = _elementy(runs, nazwa_wej)
    wezel = wezly_def[nazwa_wej]
    param = wezel["parameters"]

    deklaracje = None
    gdzie = None
    if wezel["type"] == "n8n-nodes-base.set" and param.get("mode") == "manual":
        deklaracje = [
            {"pole": a["name"], "typN8n": a["type"], "wartoscZadeklarowana": a["value"]}
            for a in param["assignments"]["assignments"]
        ]
        gdzie = f"nodes[name='{nazwa_wej}'].parameters.assignments.assignments"
    elif wezel["type"] == "n8n-nodes-base.set" and param.get("mode") == "raw":
        gdzie = f"nodes[name='{nazwa_wej}'].parameters.jsonOutput (tekst JSON)"
    elif wezel["type"] == "n8n-nodes-base.code":
        gdzie = f"nodes[name='{nazwa_wej}'].parameters.jsCode (literal w kodzie JS)"

    wejscie = {
        "_kontekst": kontekst,
        "_zrodlo": {
            "opis": "Proces nie przyjmuje danych z zewnatrz: wyzwalaczem jest manualTrigger, "
                    "ktory produkuje jeden pusty element. Faktyczne wejscie dziedzinowe jest "
                    "ZASZYTE w pierwszym wezle produkujacym dane i tutaj wypisane jawnie.",
            "tabela": "execution_data",
            "kolumna": "data (format `flatted`)",
            "wiersz": f"executionId = {eid}",
            "sciezka": f'resultData.runData["{nazwa_wej}"][0].data.main[0][*].json',
            "gdzieZaszyteWDefinicji": gdzie,
        },
        "wyzwalacz": {
            "wezel": wyzwalacz,
            "typ": "n8n-nodes-base.manualTrigger",
            "elementy": [p["json"] for p in
                         runs[wyzwalacz][-1]["data"]["main"][0]],
        },
        "wezelWejscia": {
            "nazwa": nazwa_wej,
            "typ": wezel["type"],
            "typeVersion": wezel["typeVersion"],
            "tryb": param.get("mode"),
        },
        "deklaracjeTypowN8n": deklaracje,
        "liczbaElementow": len(payloady),
        "elementy": payloady,
        "kopertyN8n": koperty,
        "typy": szkielet_typow(payloady),
        "precyzjaLiczb": precyzja_liczb(payloady),
    }
    sciezka = os.path.join(baza, "wejscie.json")
    _zapisz_json(sciezka, wejscie)
    pliki.append((sciezka, {
        "typ": "baza",
        "tabela": "execution_data",
        "kolumna": "data",
        "wiersz": f"executionId = {eid}",
        "sciezka": f'resultData.runData["{nazwa_wej}"][0].data.main[0]',
        "uzupelnienie": f"workflow_entity.nodes (wiersz id='{wid}') — deklaracje typow i tryb wezla",
    }))

    # --- oczekiwane wyjscie ---
    payloady, koperty, przebieg = _elementy(runs, ostatni)
    wyjscie = {
        "_kontekst": kontekst,
        "_zrodlo": {
            "opis": "Wynik ostatniego wykonanego wezla, przepisany z migawki wykonania "
                    "bez upraszczania: te same pola, ta sama kolejnosc, te same typy "
                    "i ta sama precyzja liczb.",
            "tabela": "execution_data",
            "kolumna": "data (format `flatted`)",
            "wiersz": f"executionId = {eid}",
            "sciezka": f'resultData.runData["{ostatni}"][0].data.main[0][*].json',
        },
        "ostatniWezel": {
            "nazwa": ostatni,
            "typ": wezly_def[ostatni]["type"],
            "typeVersion": wezly_def[ostatni]["typeVersion"],
            "statusWezla": przebieg["executionStatus"],
            "czasWykonaniaMs": przebieg["executionTime"],
        },
        "kolejnoscWezlow": list(runs.keys()),
        "liczbaElementow": len(payloady),
        "elementy": payloady,
        "kopertyN8n": koperty,
        "typy": szkielet_typow(payloady),
        "precyzjaLiczb": precyzja_liczb(payloady),
    }
    sciezka = os.path.join(baza, "oczekiwane-wyjscie.json")
    _zapisz_json(sciezka, wyjscie)
    pliki.append((sciezka, {
        "typ": "baza",
        "tabela": "execution_data",
        "kolumna": "data",
        "wiersz": f"executionId = {eid}",
        "sciezka": f'resultData.runData["{ostatni}"][0].data.main[0]',
    }))

    # --- wezly posrednie ---
    # Bez nich porownanie DAG-a z n8n powie tylko "rozni sie", a nie "rozni sie na kroku
    # Stawka podatku". Plik powstaje tylko dla procesow o wiecej niz jednym wezle
    # wykonawczym; dla `status-ok` (jeden `set` po wyzwalaczu) nie ma czego posrednio
    # porownywac i pliku nie ma — to jest jawny brak, nie przeoczenie.
    wykonawcze = [n for n in runs if wezly_def[n]["type"] != "n8n-nodes-base.manualTrigger"]
    if len(wykonawcze) < 2:
        return

    kroki = []
    for pozycja, nazwa in enumerate(runs):
        payloady, koperty, przebieg = _elementy(runs, nazwa)
        wezel = wezly_def[nazwa]
        kroki.append({
            "pozycja": pozycja,
            "wezel": nazwa,
            "typ": wezel["type"],
            "typeVersion": wezel["typeVersion"],
            "rolaWGrafie": ("wyzwalacz" if wezel["type"] == "n8n-nodes-base.manualTrigger"
                            else "wejscie" if nazwa == nazwa_wej
                            else "wyjscie" if nazwa == ostatni
                            else "posredni"),
            "zrodloPoprzedniegoWezla": [z.get("previousNode") for z in przebieg.get("source", [])
                                        if z],
            "statusWezla": przebieg["executionStatus"],
            "czasWykonaniaMs": przebieg["executionTime"],
            "liczbaElementow": len(payloady),
            "elementy": payloady,
            "kopertyN8n": koperty,
            "typy": szkielet_typow(payloady),
            "precyzjaLiczb": precyzja_liczb(payloady),
            "poleDolozonePrzezTenWezel": None,
        })

    # Ktore pola dokladl kazdy krok wzgledem poprzedniego. To jest dokladnie ta informacja,
    # ktorej zabraklo przy `includeOtherFields: true` — widac, co krok ma sam wyemitowac.
    poprzednie: set = set()
    for krok in kroki:
        biezace = {k for el in krok["elementy"] if isinstance(el, dict) for k in el}
        krok["poleDolozonePrzezTenWezel"] = sorted(biezace - poprzednie)
        krok["poleZgubionePrzezTenWezel"] = sorted(poprzednie - biezace)
        poprzednie = biezace

    dok = {
        "_kontekst": kontekst,
        "_zrodlo": {
            "opis": "Wynik KAZDEGO wezla wykonania wzorcowego, w kolejnosci wykonania. "
                    "Sluzy do lokalizowania roznicy miedzy DAG-iem a n8n na konkretnym "
                    "kroku, a nie tylko na koncu procesu.",
            "tabela": "execution_data",
            "kolumna": "data (format `flatted`)",
            "wiersz": f"executionId = {eid}",
            "sciezka": "resultData.runData[*][0].data.main[0][*].json",
        },
        "liczbaWezlow": len(kroki),
        "kolejnoscWezlow": list(runs.keys()),
        "kroki": kroki,
    }
    sciezka = os.path.join(baza, "wezly-posrednie.json")
    _zapisz_json(sciezka, dok)
    pliki.append((sciezka, {
        "typ": "baza",
        "tabela": "execution_data",
        "kolumna": "data",
        "wiersz": f"executionId = {eid}",
        "sciezka": "resultData.runData[*][0].data.main[0]",
    }))


def zbuduj_wersje_premii(con, katalog: str, pliki: list) -> None:
    """Cztery wersje definicji `Premie 8% od pensji` z migawek wykonan (rejestr §1.1)."""
    wiersze = con.execute(
        "SELECT e.id, e.workflowVersionId, e.startedAt, e.stoppedAt, e.status, "
        "       d.workflowData "
        "FROM execution_entity e JOIN execution_data d ON d.executionId = e.id "
        "WHERE e.workflowId = ? ORDER BY e.id", (PREMIE_ID,)
    ).fetchall()

    wersje: dict[str, dict] = {}
    for eid, vid, start, stop, status, wfd in wiersze:
        w = wersje.setdefault(vid, {"definicje": [], "wykonania": []})
        w["definicje"].append(json.loads(wfd))
        w["wykonania"].append({
            "wykonanie": eid, "rozpoczete": start, "zakonczone": stop, "status": status,
        })

    biezacy = con.execute(
        "SELECT versionId FROM workflow_entity WHERE id = ?", (PREMIE_ID,)
    ).fetchone()[0]
    w_history = {r[0] for r in con.execute(
        "SELECT versionId FROM workflow_history WHERE workflowId = ?", (PREMIE_ID,))}

    kolejnosc = sorted(wersje, key=lambda v: wersje[v]["wykonania"][0]["wykonanie"])
    for nr, vid in enumerate(kolejnosc, start=1):
        w = wersje[vid]
        # Wszystkie migawki tej samej wersji musza byc identyczne — inaczej versionId klamie.
        wzorzec = json.dumps(w["definicje"][0], sort_keys=True, ensure_ascii=False)
        for inna in w["definicje"][1:]:
            if json.dumps(inna, sort_keys=True, ensure_ascii=False) != wzorzec:
                raise SystemExit(f"STOP: rozbiezne migawki dla versionId {vid}")
        definicja_w = w["definicje"][0]
        dok = {
            "_kontekst": {
                "workflowId": PREMIE_ID,
                "nazwaN8n": definicja_w.get("name"),
                "dagRoboczy": "premie-od-pensji",
                "versionId": vid,
                "kolejnosc": nr,
                "kolejnoscZ": len(kolejnosc),
                "wersjaBiezaca": vid == biezacy,
                "obecnaWWorkflowHistory": vid in w_history,
                "sekcjaRejestru": "§1.1",
                "znacznikEkstrakcji": ZNACZNIK,
            },
            "_zrodlo": {
                "opis": "Pelna definicja procesu w chwili wykonania. Dla trzech wersji "
                        "posrednich to JEDYNE miejsce, w ktorym przetrwaly: tabela "
                        "workflow_history trzyma wylacznie stan biezacy.",
                "tabela": "execution_data",
                "kolumna": "workflowData",
                "wiersze": [f"executionId = {x['wykonanie']}" for x in w["wykonania"]],
                "versionIdZ": "execution_entity.workflowVersionId "
                              "(= execution_data.workflowVersionId, sprawdzone)",
            },
            "wykonania": w["wykonania"],
            "liczbaWezlow": len(definicja_w["nodes"]),
            "wezly": [n["name"] for n in definicja_w["nodes"]],
            "definicja": definicja_w,
        }
        sciezka = os.path.join(katalog, "premie-od-pensji", "wersje",
                               f"{nr:02d}-{vid}.json")
        _zapisz_json(sciezka, dok)
        pliki.append((sciezka, {
            "typ": "baza",
            "tabela": "execution_data",
            "kolumna": "workflowData",
            "wiersze": [f"executionId = {x['wykonanie']}" for x in w["wykonania"]],
            "klucz": f"workflowVersionId = '{vid}'",
        }))


def zbuduj_artefakty(con, katalog: str, pliki: list) -> None:
    for a in ARTEFAKTY:
        d = definicja(con, a["workflowId"])
        sciezka = os.path.join(katalog, "_artefakty-historyczne", a["katalog"],
                               "definicja-n8n.json")
        _zapisz_json(sciezka, {
            "_kontekst": {
                "workflowId": a["workflowId"],
                "nazwaN8n": d["name"],
                "klasyfikacja": "ARTEFAKT-HISTORYCZNY",
                "powodZachowania": a["powod"],
                "sekcjaRejestru": "§2",
                "odtwarzanyWDagu": False,
                "znacznikEkstrakcji": ZNACZNIK,
            },
            "definicja": d,
        })
        pliki.append((sciezka, zrodlo_definicji(a["workflowId"])))


PLIKI_STATYCZNE = [
    ("README.md", "dokumentacja", "opis pochodzenia fixture, sposobu odtworzenia "
                                  "ekstrakcji i rozliczenia wszystkich 15 workflow"),
    ("_narzedzia/ekstrakcja.py", "narzedzie", "skrypt, ktory wygenerowal to drzewo"),
    ("_narzedzia/weryfikuj.py", "narzedzie", "weryfikacja fixture wobec migawki i manifestu"),
    ("_narzedzia/flatted.py", "narzedzie", "dekoder formatu `flatted` z execution_data.data"),
    ("_narzedzia/sprawdz-sumy.sh", "narzedzie", "niezalezne przeliczenie sha256 z manifestu"),
    ("_narzedzia/porownaj.py", "narzedzie", "porownanie wynikow DAG-ow Dagu z fixture"),
]


def dopisz_pliki_statyczne(katalog: str, pliki: list) -> None:
    """Manifest ma pokrywac KAZDY plik w fixtures/, takze wlasne narzedzia."""
    for wzgledna, typ, opis in PLIKI_STATYCZNE:
        sciezka = os.path.join(katalog, wzgledna)
        if not os.path.exists(sciezka):
            raise SystemExit(f"STOP: brak pliku {wzgledna} — manifest bylby niepelny")
        pliki.append((sciezka, {"typ": typ, "opis": opis}))


def zbuduj_manifest(con, katalog: str, pliki: list, migawka: str) -> None:
    liczniki = {
        t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ("workflow_entity", "execution_entity", "execution_data",
                  "workflow_history", "credentials_entity")
    }
    wpisy = []
    for sciezka, zrodlo in sorted(pliki):
        wzgledna = os.path.relpath(sciezka, katalog)
        wpisy.append({
            "sciezka": wzgledna,
            "rozmiarB": os.path.getsize(sciezka),
            "sha256": _sha256(sciezka),
            "zrodlo": zrodlo,
            "znacznikEkstrakcji": ZNACZNIK,
        })
    manifest = {
        "wersjaManifestu": 1,
        "znacznikEkstrakcji": ZNACZNIK,
        "migawka": {
            "opis": "Spojna migawka zywej bazy n8n zrobiona natywnym online-backupem "
                    "SQLite (`.backup`) z wolumenu zamontowanego read-only. "
                    "Plik NIE wchodzi do repozytorium.",
            "nazwaPliku": os.path.basename(migawka),
            "rozmiarB": os.path.getsize(migawka),
            "sha256": _sha256(migawka),
            "integrity_check": con.execute("PRAGMA integrity_check").fetchone()[0],
            "liczbaWierszy": liczniki,
        },
        "zrodloDanych": {
            "wolumen": "n8niframe_n8n_data",
            "kontener": "n8niframe-n8n",
            "plik": "/home/node/.n8n/database.sqlite (+ -wal, -shm)",
            "montowanie": "read-only",
        },
        "polaPominiete": POLA_POMINIETE,
        "liczbaPlikow": len(wpisy),
        "uwagaOManifescie": "Manifest pokrywa kazdy plik w fixtures/ oprocz samego "
                            "MANIFEST.json — nie moze zawierac wlasnej sumy kontrolnej.",
        "pliki": wpisy,
    }
    _zapisz_json(os.path.join(katalog, "MANIFEST.json"), manifest,
                 wzorce=WZORCE_SEKRETOW_MANIFEST)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    migawka = os.path.abspath(sys.argv[1])
    katalog = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

    con = sqlite3.connect(f"file:{migawka}?mode=ro", uri=True)
    try:
        pliki: list = []
        for proces in PROCESY:
            zbuduj_proces(con, proces, katalog, pliki)
        zbuduj_wersje_premii(con, katalog, pliki)
        zbuduj_artefakty(con, katalog, pliki)
        dopisz_pliki_statyczne(katalog, pliki)
        zbuduj_manifest(con, katalog, pliki, migawka)
    finally:
        con.close()

    print(f"Zapisano {len(pliki)} plikow fixture + MANIFEST.json w {katalog}")
    print(f"Znacznik ekstrakcji: {ZNACZNIK}")


if __name__ == "__main__":
    main()
