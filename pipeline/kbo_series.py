"""KBO daily-log series dropdown (regular season and postseason).

The Korean stat site (koreabaseball.com player Daily.aspx) lists series in
``ddlSeries``. The English game-log pages do not. Option text for 2026:

- KBO 정규시즌
- KBO 시범경기
- KBO 와일드카드
- KBO 준플레이오프
- KBO 플레이오프
- KBO 한국시리즈

``플레이오프`` is a substring of ``준플레이오프``, so matching has to reject
the semi-playoff option when the requested label is the playoff.
"""

from __future__ import annotations

import requests
from bs4 import BeautifulSoup

REGULAR_SERIES_LABEL = "KBO 정규시즌"
POSTSEASON_SERIES_LABELS = (
    "KBO 와일드카드",
    "KBO 준플레이오프",
    "KBO 플레이오프",
    "KBO 한국시리즈",
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def postseason_labels_for_season(season):
    """Postseason series are scraped for 2026 and later seasons."""
    try:
        year = int(season)
    except (TypeError, ValueError):
        return ()
    if year >= 2026:
        return POSTSEASON_SERIES_LABELS
    return ()


def series_label_matches(option_text, label):
    """True when a dropdown option is the requested series.

    ``KBO 준플레이오프`` contains ``플레이오프`` but is not the playoff series.
    """
    text = " ".join(str(option_text or "").split())
    needle = " ".join(str(label or "").split())
    if not text or not needle:
        return False
    if "준플레이오프" in text and "준플레이오프" not in needle and "플레이오프" in needle:
        return False
    return needle in text


def iter_series_targets(options, labels):
    """Return dropdown targets in ``labels`` order, one option each."""
    chosen = []
    used = set()
    for label in labels:
        for opt in options or []:
            value = str(opt.get("value"))
            text = " ".join(str(opt.get("text") or "").split())
            if not value or value in used:
                continue
            if series_label_matches(text, label):
                chosen.append({"value": value, "text": text, "label": label})
                used.add(value)
                break
    return chosen


def read_select_options(html, id_suffix):
    soup = BeautifulSoup(html, "html.parser")
    select = soup.select_one(f"select[id$='{id_suffix}']")
    if select is None:
        return []
    options = []
    for opt in select.find_all("option"):
        options.append({
            "value": opt.get("value"),
            "text": opt.get_text(strip=True),
            "selected": opt.has_attr("selected"),
        })
    return options


def _form_data(html):
    soup = BeautifulSoup(html, "html.parser")
    data = {}
    for inp in soup.select("input[type=hidden]"):
        name = inp.get("name")
        if name:
            data[name] = inp.get("value") or ""
    for select in soup.select("select"):
        name = select.get("name")
        if not name:
            continue
        chosen = select.find("option", selected=True)
        data[name] = chosen.get("value") if chosen is not None else ""
    return data


def post_select(session, url, html, id_suffix, value, timeout=30):
    """ASP.NET postback that changes one Daily.aspx dropdown."""
    soup = BeautifulSoup(html, "html.parser")
    target = soup.select_one(f"select[id$='{id_suffix}']")
    if target is None or not target.get("name"):
        raise RuntimeError(f"KBO page is missing select *{id_suffix}")
    data = _form_data(html)
    data["__EVENTTARGET"] = target.get("name")
    data["__EVENTARGUMENT"] = ""
    data[target.get("name")] = str(value)
    response = session.post(
        url,
        data=data,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": url,
        },
        timeout=timeout,
    )
    response.raise_for_status()
    return response.text


def load_series_pages(url, season, labels, session=None, timeout=30):
    """GET a player daily page and return ``(series_text, html)`` for ``labels``.

    The year dropdown is switched to ``season`` when that year exists. Series
    that are not on the page are skipped.
    """
    session = session or requests.Session()
    headers = {"User-Agent": USER_AGENT}
    html = session.get(url, headers=headers, timeout=timeout).text
    years = read_select_options(html, "ddlYear")
    year_values = {str(opt["value"]) for opt in years}
    selected_year = next((str(opt["value"]) for opt in years if opt.get("selected")), None)
    if str(season) in year_values and selected_year != str(season):
        html = post_select(session, url, html, "ddlYear", str(season), timeout=timeout)

    options = read_select_options(html, "ddlSeries")
    pages = []
    for target in iter_series_targets(options, labels):
        page = post_select(session, url, html, "ddlSeries", target["value"], timeout=timeout)
        pages.append((target["text"], page))
    return pages
