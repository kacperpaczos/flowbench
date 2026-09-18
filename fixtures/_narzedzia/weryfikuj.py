#!/usr/bin/env python3
"""Weryfikacja fixture wobec migawki bazy i wobec MANIFEST.json.

Sprawdza cztery rzeczy, kazda osobno i kazda z wypisanym wynikiem:

1. `integrity_check` migawki oraz liczby wierszy 15 / 12 / 12 wobec rejestru.
2. Kazdy `wejscie.json` i `oczekiwane-wyjscie.json` jest bajt w bajt tym samym
   dokumentem co odpowiedni fragment migawki wykonania — porownanie idzie po
   kanonicznym JSON-ie, wiec lapie tez roznice `1` vs `1.0` i zmiane kolejnosci.
3. Cztery wersje `premie-od-pensji` zgadzaja sie z `execution_data.workflowData`,
   a lista wykonan pod kazda wersja — z `execution_entity.workflowVersionId`.
4. Kazdy wpis MANIFEST.json ma zgodny rozmiar i sha256.

Uzycie:
    python3 fixtures/_narzedzia/weryfikuj.py <sciezka-do-migawki> [<katalog-fixtures>]

Kod wyjscia: 0 = wszystko zgodne, 1 = jakakolwiek rozbieznosc.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import flatted  # noqa: E402
from ekstrakcja import PROCESY, PREMIE_ID  # noqa: E402

OCZEKIWANE_LICZNOSCI = {
    "workflow_entity": 15,
    "execution_entity": 12,
    "execution_data": 12,
}

bledy: list[str] = []


def kanon(v) -> str:
    """Kanoniczny zapis JSON — rozroznia integer od number, zachowuje kolejnosc."""
    return json.dumps(v, ensure_ascii=False, sort_keys=False)


def sprawdz(warunek: bool, opis: str) -> None:
    print(f"  [{'OK ' if warunek else 'BLAD'}] {opis}")
    if not warunek:
        bledy.append(opis)


def sha256(sciezka: str) -> str:
    h = hashlib.sha256()
    with open(sciezka, "rb") as f:
        for kawalek in iter(lambda: f.read(65536), b""):
            h.update(kawalek)
    return h.hexdigest()


def runda_migawka(con, migawka: str) -> None:
    print("\n=== 1. Migawka bazy ===")
    wynik = con.execute("PRAGMA integrity_check").fetchone()[0]
    sprawdz(wynik == "ok", f"PRAGMA integrity_check = {wynik}")
    for tabela, oczekiwane in OCZEKIWANE_LICZNOSCI.items():
        ile = con.execute(f"SELECT count(*) FROM {tabela}").fetchone()[0]
        sprawdz(ile == oczekiwane, f"{tabela} = {ile} (rejestr: {oczekiwane})")
    print(f"  sha256(migawka) = {sha256(migawka)}")


def elementy_z_migawki(con, eid: int, wezel: str | None):
    dane = flatted.parse(con.execute(
        "SELECT data FROM execution_data WHERE executionId = ?", (eid,)).fetchone()[0])
    runs = dane["resultData"]["runData"]
    nazwa = wezel or dane["resultData"]["lastNodeExecuted"]
    przebieg = runs[nazwa][-1]
    pozycje = przebieg["data"]["main"][0]
    return nazwa, [p["json"] for p in pozycje]


def runda_procesy(con, katalog: str) -> None:
    print("\n=== 2. Fixture wejscie/wyjscie wobec migawek wykonan ===")
    for proces in PROCESY:
        dag, eid = proces["dag"], proces["wykonanieWzorcowe"]
        print(f"\n  -- {dag} (wykonanie #{eid}) --")

        sciezka = os.path.join(katalog, dag, "wejscie.json")
        fix = json.load(open(sciezka, encoding="utf-8"))
        _, oczek = elementy_z_migawki(con, eid, proces["wezelWejscia"])
        sprawdz(kanon(fix["elementy"]) == kanon(oczek),
                f"wejscie.json: {len(oczek)} el. identycznych z migawka "
                f'(wezel "{proces["wezelWejscia"]}")')

        sciezka = os.path.join(katalog, dag, "oczekiwane-wyjscie.json")
        fix = json.load(open(sciezka, encoding="utf-8"))
        nazwa, oczek = elementy_z_migawki(con, eid, None)
        sprawdz(fix["ostatniWezel"]["nazwa"] == nazwa,
                f'oczekiwane-wyjscie.json: ostatni wezel = "{nazwa}"')
        sprawdz(kanon(fix["elementy"]) == kanon(oczek),
                f"oczekiwane-wyjscie.json: {len(oczek)} el. identycznych z migawka")

        sciezka = os.path.join(katalog, dag, "definicja-n8n.json")
        fix = json.load(open(sciezka, encoding="utf-8"))
        wiersz = con.execute("SELECT name, nodes, versionId FROM workflow_entity "
                             "WHERE id = ?", (proces["workflowId"],)).fetchone()
        sprawdz(fix["name"] == wiersz[0] and fix["versionId"] == wiersz[2]
                and kanon(fix["nodes"]) == kanon(json.loads(wiersz[1])),
                f"definicja-n8n.json: name/versionId/nodes zgodne z workflow_entity")


def porownanie_pol(con, katalog: str, dag: str, eid: int) -> None:
    """Pole po polu: wartosc i typ w migawce vs w fixture. Dowod dla kryterium 3."""
    print(f"\n=== 3. Porownanie pole-po-polu: {dag} (wykonanie #{eid}) ===")
    fix = json.load(open(os.path.join(katalog, dag, "oczekiwane-wyjscie.json"),
                         encoding="utf-8"))
    _, oczek = elementy_z_migawki(con, eid, None)

    def splaszcz(v, sciezka=""):
        if isinstance(v, dict):
            for k in v:
                yield from splaszcz(v[k], f"{sciezka}.{k}" if sciezka else k)
        elif isinstance(v, list):
            for i, el in enumerate(v):
                yield from splaszcz(el, f"{sciezka}[{i}]")
        else:
            yield sciezka, v

    z_bazy = list(splaszcz(oczek))
    z_fix = list(splaszcz(fix["elementy"]))
    sprawdz(len(z_bazy) == len(z_fix),
            f"liczba lisci: migawka {len(z_bazy)}, fixture {len(z_fix)}")

    naglowek = f"  {'pole':<34} {'migawka':>14} {'typ':<8} {'fixture':>14} {'typ':<8} zgodne"
    print(naglowek)
    print("  " + "-" * (len(naglowek) - 2))
    zgodnych = 0
    for (p1, v1), (p2, v2) in zip(z_bazy, z_fix):
        t1, t2 = type(v1).__name__, type(v2).__name__
        ok = p1 == p2 and repr(v1) == repr(v2) and t1 == t2
        zgodnych += ok
        print(f"  {p1:<34} {repr(v1):>14} {t1:<8} {repr(v2):>14} {t2:<8} "
              f"{'tak' if ok else 'NIE'}")
    sprawdz(zgodnych == len(z_bazy),
            f"{zgodnych}/{len(z_bazy)} lisci zgodnych co do sciezki, wartosci i typu")


def runda_wersje(con, katalog: str) -> None:
    print("\n=== 4. Cztery wersje procesu Premie ===")
    katalog_wersji = os.path.join(katalog, "premie-od-pensji", "wersje")
    pliki = sorted(os.listdir(katalog_wersji))
    sprawdz(len(pliki) == 4, f"liczba plikow wersji = {len(pliki)}")

    z_bazy: dict[str, list[int]] = {}
    for eid, vid in con.execute(
            "SELECT id, workflowVersionId FROM execution_entity "
            "WHERE workflowId = ? ORDER BY id", (PREMIE_ID,)):
        z_bazy.setdefault(vid, []).append(eid)
    sprawdz(len(z_bazy) == 4, f"roznych versionId w execution_entity = {len(z_bazy)}")

    for nazwa in pliki:
        dok = json.load(open(os.path.join(katalog_wersji, nazwa), encoding="utf-8"))
        vid = dok["_kontekst"]["versionId"]
        wykonania = [w["wykonanie"] for w in dok["wykonania"]]
        sprawdz(wykonania == z_bazy.get(vid),
                f"{nazwa}: wykonania {wykonania} = {z_bazy.get(vid)} z bazy")
        eid = wykonania[0]
        wfd = json.loads(con.execute(
            "SELECT workflowData FROM execution_data WHERE executionId = ?",
            (eid,)).fetchone()[0])
        sprawdz(kanon(dok["definicja"]) == kanon(wfd),
                f"{nazwa}: definicja = execution_data.workflowData (#{eid}), "
                f"{dok['liczbaWezlow']} wezlow")


def runda_manifest(katalog: str) -> None:
    print("\n=== 5. MANIFEST.json ===")
    manifest = json.load(open(os.path.join(katalog, "MANIFEST.json"), encoding="utf-8"))
    for wpis in manifest["pliki"]:
        sciezka = os.path.join(katalog, wpis["sciezka"])
        rozmiar = os.path.getsize(sciezka)
        suma = sha256(sciezka)
        sprawdz(rozmiar == wpis["rozmiarB"] and suma == wpis["sha256"],
                f"{wpis['sciezka']}  {rozmiar} B  {suma[:16]}…")

    na_dysku = set()
    for korzen, katalogi, nazwy in os.walk(katalog):
        katalogi[:] = [k for k in katalogi if k != "__pycache__"]
        for n in nazwy:
            wzgledna = os.path.relpath(os.path.join(korzen, n), katalog)
            if wzgledna != "MANIFEST.json":
                na_dysku.add(wzgledna)
    w_manifescie = {w["sciezka"] for w in manifest["pliki"]}
    sprawdz(na_dysku == w_manifescie,
            f"pokrycie: {len(w_manifescie)} wpisow = {len(na_dysku)} plikow na dysku "
            f"(bez MANIFEST.json); nadmiarowe na dysku: "
            f"{sorted(na_dysku - w_manifescie) or 'brak'}")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    migawka = os.path.abspath(sys.argv[1])
    katalog = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

    con = sqlite3.connect(f"file:{migawka}?mode=ro", uri=True)
    try:
        runda_migawka(con, migawka)
        runda_procesy(con, katalog)
        porownanie_pol(con, katalog, "premie-od-pensji", 11)
        runda_wersje(con, katalog)
        runda_manifest(katalog)
    finally:
        con.close()

    print()
    if bledy:
        print(f"WYNIK: {len(bledy)} rozbieznosci")
        for b in bledy:
            print(f"  - {b}")
        sys.exit(1)
    print("WYNIK: wszystko zgodne")


if __name__ == "__main__":
    main()
