#!/usr/bin/env python3
"""Porownanie wynikow DAG-ow Dagu z fixture wyjetymi z n8n.

Porownuje pieciu wymiarach wymaganych przez zadanie, kazdy osobno i kazdy z jawnym
wynikiem, zeby "rozni sie" nigdy nie bylo cala odpowiedzia:

  1. WARTOSCI      - kazda wartosc liscia, po kanonicznym zapisie (`repr`)
  2. TYPY          - int/float/str/bool/None; `1` i `1.0` to ROZNE wartosci
  3. PRECYZJA      - liczba cyfr po przecinku w zapisie dziesietnym
  4. KOLEJNOSC     - kolejnosc elementow tablic ORAZ kolejnosc kluczy w obiektach
  5. KOMPLET POL   - pola nadmiarowe i brakujace, osobno

Zrodlem wyniku DAG-a jest stdout ostatniego kroku, czyli dokladnie ta wartosc, ktora
silnik walidowal przez `output_schema` i opublikowal przez `output:` (kontrakt K1-K4).
Skrypt czyta ja z drzewa logow Dagu - nie z posrednika, nie z przepisania recznego.

Uzycie:
    python3 fixtures/_narzedzia/porownaj.py <katalog-logow-dagu> [<katalog-fixtures>]

Kod wyjscia: 0 = wszystkie procesy zgodne, 1 = jakakolwiek roznica.
"""
from __future__ import annotations

import json
import os
import re
import sys

# DAG -> (nazwa kroku koncowego w logach, katalog fixture, etykieta wariantu)
# Nazwa kroku w sciezce logu pochodzi z pola `name:` kroku, ze spacjami zamienionymi na `_`.
PROCESY = [
    {"dag": "status-ok",
     "ostatniKrok": "Set_Status",
     "fixture": "status-ok",
     "wariant": None},
    {"dag": "demo-mcp-wartosc-zamowienia",
     "ostatniKrok": "Policz_wartosc_brutto",
     "fixture": "demo-mcp-wartosc-zamowienia",
     "wariant": None},
    {"dag": "lista-produktow-suma-zamowienia",
     "ostatniKrok": "Policz_sume_zamowienia",
     "fixture": "lista-produktow-suma-zamowienia",
     "wariant": None},
    {"dag": "premie-od-pensji",
     "ostatniKrok": "Suma_premii",
     "fixture": "premie-od-pensji",
     "wariant": "A — wiernosc liczb (graf liniowy, jak w n8n)"},
    {"dag": "premie-od-pensji-galezie",
     "ostatniKrok": "Suma_premii",
     "fixture": "premie-od-pensji",
     "wariant": "B — rozgalezienie + fan-in (graf INNY niz w n8n)"},
]

# Wezly n8n, ktore maja odpowiednik 1:1 w krokach DAG-a. Nazwa jest ta SAMA po obu
# stronach, bo `name:` kroku Dagu zostalo celowo ustawione na nazwe wezla n8n - dzieki
# temu porownanie krok-po-kroku nie wymaga zadnej tabeli tlumaczen.
KROKI_POSREDNIE = {
    "demo-mcp-wartosc-zamowienia": [
        "Pozycja zamowienia", "Policz wartosc brutto",
    ],
    "lista-produktow-suma-zamowienia": [
        "Lista produktow", "Policz sume zamowienia",
    ],
    "premie-od-pensji": [
        "Dane pracownikow", "Premia 8%", "Dodatek 50 zl",
        "Stawka podatku", "Podatek dochodowy", "Suma premii",
    ],
}


# --- odczyt wyniku z drzewa logow Dagu --------------------------------------

def ostatni_przebieg(logi: str, dag: str) -> str:
    katalog = os.path.join(logi, dag)
    if not os.path.isdir(katalog):
        raise SystemExit(f"STOP: brak logow DAG-a {dag} w {logi}")
    przebiegi = sorted(d for d in os.listdir(katalog) if d.startswith("dag-run_"))
    if not przebiegi:
        raise SystemExit(f"STOP: DAG {dag} nie byl jeszcze uruchamiany")
    return os.path.join(katalog, przebiegi[-1])


def nazwa_w_logu(nazwa_kroku: str) -> str:
    """Silnik odkaza nazwe kroku, zanim uzyje jej w nazwie pliku logu.

    Sprawdzone wykonaniem: spacja i `%` staja sie `_` ("Premia 8%" -> "Premia_8_").
    Nazwa wyswietlana kroku NIE wraca wiec z nazwy pliku bez strat - narzedzie
    czytajace logi musi znac te regule, inaczej gubi krok i mysli, ze go nie bylo.
    """
    return re.sub(r"[^A-Za-z0-9_.-]", "_", nazwa_kroku)


def stdout_kroku(logi: str, dag: str, krok: str):
    """stdout kroku z NAJNOWSZEGO przebiegu DAG-a, sparsowany jako JSON."""
    krok = nazwa_w_logu(krok)
    przebieg = ostatni_przebieg(logi, dag)
    kandydaci = []
    for korzen, _, nazwy in os.walk(przebieg):
        for n in nazwy:
            if n.startswith(krok + ".") and n.endswith(".out"):
                kandydaci.append(os.path.join(korzen, n))
    if not kandydaci:
        return None, f"brak stdout kroku {krok} w {os.path.basename(przebieg)}"
    sciezka = sorted(kandydaci)[-1]
    with open(sciezka, encoding="utf-8") as f:
        tekst = f.read()
    if not tekst.strip():
        return None, f"stdout kroku {krok} jest pusty (krok pominiety albo nieudany)"
    try:
        return json.loads(tekst), None
    except json.JSONDecodeError as e:
        return None, f"stdout kroku {krok} nie jest jednym dokumentem JSON: {e}"


# --- porownanie -------------------------------------------------------------

def liscie(v, sciezka=""):
    """Plaska lista (sciezka, wartosc) w kolejnosci wystepowania."""
    if isinstance(v, dict):
        for k in v:
            yield from liscie(v[k], f"{sciezka}.{k}" if sciezka else k)
    elif isinstance(v, list):
        for i, el in enumerate(v):
            yield from liscie(el, f"{sciezka}[{i}]")
    else:
        yield sciezka, v


def precyzja(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    t = repr(v)
    return len(t.split(".")[1]) if "." in t else 0


def kolejnosc_kluczy(v, sciezka=""):
    """Mapa sciezka-obiektu -> lista kluczy w kolejnosci zapisu."""
    out = {}
    if isinstance(v, dict):
        out[sciezka or "."] = list(v)
        for k in v:
            out.update(kolejnosc_kluczy(v[k], f"{sciezka}.{k}" if sciezka else k))
    elif isinstance(v, list):
        for i, el in enumerate(v):
            out.update(kolejnosc_kluczy(el, f"{sciezka}[{i}]"))
    return out


def porownaj(oczekiwane, otrzymane) -> dict:
    """Piec wymiarow porownania. Zwraca slownik wynikow i listy roznic."""
    lo = list(liscie(oczekiwane))
    lp = list(liscie(otrzymane))
    sciezki_o = [s for s, _ in lo]
    sciezki_p = [s for s, _ in lp]
    mapa_o, mapa_p = dict(lo), dict(lp)

    brakujace = [s for s in sciezki_o if s not in mapa_p]
    nadmiarowe = [s for s in sciezki_p if s not in mapa_o]
    wspolne = [s for s in sciezki_o if s in mapa_p]

    rozne_wartosci, rozne_typy, rozne_precyzje = [], [], []
    for s in wspolne:
        a, b = mapa_o[s], mapa_p[s]
        if repr(a) != repr(b):
            rozne_wartosci.append((s, repr(a), repr(b)))
        if type(a) is not type(b):
            rozne_typy.append((s, type(a).__name__, type(b).__name__))
        if precyzja(a) != precyzja(b):
            rozne_precyzje.append((s, precyzja(a), precyzja(b)))

    # Kolejnosc elementow tablic jest zakodowana w sciezkach ([0], [1], ...),
    # wiec identyczna lista sciezek w identycznej kolejnosci = identyczna kolejnosc.
    kolejnosc_el = sciezki_o == sciezki_p
    ko, kp = kolejnosc_kluczy(oczekiwane), kolejnosc_kluczy(otrzymane)
    rozne_klucze = [(s, ko[s], kp[s]) for s in ko if s in kp and ko[s] != kp[s]]

    return {
        "liczbaLisci": (len(lo), len(lp)),
        "wartosci": rozne_wartosci,
        "typy": rozne_typy,
        "precyzja": rozne_precyzje,
        "kolejnoscElementow": kolejnosc_el,
        "kolejnoscKluczy": rozne_klucze,
        "brakujace": brakujace,
        "nadmiarowe": nadmiarowe,
    }


def wynik_ok(w: dict) -> bool:
    return (not w["wartosci"] and not w["typy"] and not w["precyzja"]
            and w["kolejnoscElementow"] and not w["kolejnoscKluczy"]
            and not w["brakujace"] and not w["nadmiarowe"])


def wiersz(w: dict) -> str:
    def z(puste, etykieta):
        return "zgodne" if puste else etykieta
    komplet = "-{}/+{}".format(len(w["brakujace"]), len(w["nadmiarowe"]))
    kolejnosc = ("zgodna" if w["kolejnoscElementow"] and not w["kolejnoscKluczy"]
                 else "ROZNA")
    return (f"{z(not w['wartosci'], str(len(w['wartosci'])) + ' roznic'):<12} "
            f"{z(not w['typy'], str(len(w['typy'])) + ' roznic'):<12} "
            f"{z(not w['precyzja'], str(len(w['precyzja'])) + ' roznic'):<12} "
            f"{kolejnosc:<10} "
            f"{z(not w['brakujace'] and not w['nadmiarowe'], komplet):<12}")


def wypisz_roznice(w: dict, wciecie="      ") -> None:
    for s, a, b in w["wartosci"]:
        print(f"{wciecie}WARTOSC   {s}: fixture={a}  dagu={b}")
    for s, a, b in w["typy"]:
        print(f"{wciecie}TYP       {s}: fixture={a}  dagu={b}")
    for s, a, b in w["precyzja"]:
        print(f"{wciecie}PRECYZJA  {s}: fixture={a} cyfr  dagu={b} cyfr")
    for s in w["brakujace"]:
        print(f"{wciecie}BRAKUJE   {s}")
    for s in w["nadmiarowe"]:
        print(f"{wciecie}NADMIAR   {s}")
    for s, a, b in w["kolejnoscKluczy"]:
        print(f"{wciecie}KLUCZE    {s}: fixture={a}  dagu={b}")
    if not w["kolejnoscElementow"]:
        print(f"{wciecie}KOLEJNOSC elementow tablic rozni sie od fixture")


# --- glowna petla -----------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    logi = os.path.abspath(sys.argv[1])
    katalog = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

    bledy = 0
    print("=" * 100)
    print("WYNIK KONCOWY: DAG vs fixture n8n")
    print("=" * 100)
    naglowek = (f"  {'proces':<34} {'wartosci':<12} {'typy':<12} {'precyzja':<12} "
                f"{'kolejnosc':<10} {'komplet pol':<12}")
    print(naglowek)
    print("  " + "-" * (len(naglowek) - 2))

    szczegoly = []
    for p in PROCESY:
        fx = os.path.join(katalog, p["fixture"], "oczekiwane-wyjscie.json")
        oczekiwane = json.load(open(fx, encoding="utf-8"))["elementy"]
        dokument, blad = stdout_kroku(logi, p["dag"], p["ostatniKrok"])
        if blad:
            print(f"  {p['dag']:<34} BLAD ODCZYTU: {blad}")
            bledy += 1
            continue
        if not isinstance(dokument, dict) or "elementy" not in dokument:
            print(f"  {p['dag']:<34} BLAD: wynik nie ma pola `elementy`")
            bledy += 1
            continue
        w = porownaj(oczekiwane, dokument["elementy"])
        print(f"  {p['dag']:<34} {wiersz(w)}")
        if not wynik_ok(w):
            bledy += 1
        szczegoly.append((p, w))

    for p, w in szczegoly:
        if not wynik_ok(w):
            print(f"\n  --- roznice: {p['dag']} ---")
            wypisz_roznice(w)

    print("\n" + "=" * 100)
    print("KROKI POSREDNIE: kazdy krok DAG-a vs odpowiadajacy wezel n8n")
    print("=" * 100)
    for p in PROCESY:
        wezly_do_porownania = KROKI_POSREDNIE.get(p["dag"])
        if not wezly_do_porownania:
            powod = ("wariant B ma INNY graf niz n8n - kroki posrednie nie maja "
                     "odpowiednikow 1:1 i nie sa porownywane"
                     if p["wariant"] and p["wariant"].startswith("B")
                     else "proces ma jeden wezel wykonawczy - nie ma krokow posrednich")
            print(f"\n  {p['dag']}: pominiete ({powod})")
            continue
        fx = os.path.join(katalog, p["fixture"], "wezly-posrednie.json")
        wezly = {k["wezel"]: k["elementy"] for k in
                 json.load(open(fx, encoding="utf-8"))["kroki"]}
        print(f"\n  {p['dag']}:")
        for wezel in wezly_do_porownania:
            dokument, blad = stdout_kroku(logi, p["dag"], wezel)
            if blad:
                print(f"    {wezel:<22} BLAD: {blad}")
                bledy += 1
                continue
            w = porownaj(wezly[wezel], dokument["elementy"])
            status = "zgodne" if wynik_ok(w) else "ROZNICE"
            print(f"    wezel n8n `{wezel}`{'':<{max(0, 22 - len(wezel))}} -> krok DAG-a  "
                  f"{status}  ({w['liczbaLisci'][0]} lisci)")
            if not wynik_ok(w):
                wypisz_roznice(w, "        ")
                bledy += 1

    print()
    if bledy:
        print(f"WYNIK: {bledy} procesow/krokow z roznicami")
        sys.exit(1)
    print("WYNIK: wszystkie procesy i wszystkie kroki posrednie zgodne z fixture")


if __name__ == "__main__":
    main()
