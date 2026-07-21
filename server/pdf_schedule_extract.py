"""Extract course blocks from the grid PDF exported by JLU's course system.

The script writes only JSON to stdout. It never returns the student name or
student number that may appear in the uploaded timetable PDF.
"""

import json
import re
import sys

import pdfplumber


DAY_MAP = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
           "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7}
COURSE_START = re.compile(r"(?=ae\d{8,}-|gx\d{8,}-)", re.I)
COURSE_CODE = re.compile(r"^(?:ae|gx)\d{8,}-", re.I)
DETAIL_LINE = re.compile(r"(?:\d+(?:-\d+)?周|星期[一二三四五六日天1-7]|第\d+节)")
SECTION = re.compile(r"第\s*(\d+)\s*节\s*-\s*第?\s*(\d+)\s*节")


def compact(value):
    return re.sub(r"\s+", "", str(value or ""))


def weekday(value):
    found = re.search(r"星期\s*([一二三四五六日天1-7])", compact(value))
    return DAY_MAP.get(found.group(1)) if found else None


def section_label(value):
    found = SECTION.search(compact(value))
    return f"第{found.group(1)}节-第{found.group(2)}节" if found else ""


def split_course_blocks(value):
    value = str(value or "").strip()
    starts = list(COURSE_START.finditer(value))
    if not starts:
        return []
    return [value[match.start(): starts[index + 1].start() if index + 1 < len(starts) else len(value)]
            for index, match in enumerate(starts)]


def course_entry(block, column_day, row_section):
    lines = [compact(line) for line in str(block).splitlines() if compact(line)]
    if not lines:
        return None
    lines[0] = COURSE_CODE.sub("", lines[0])
    detail_at = next((index for index, line in enumerate(lines) if DETAIL_LINE.search(line)), len(lines))
    name = re.sub(r"\[\d+\]", "", "".join(lines[:detail_at])).strip("-,，")
    if len(name) < 2:
        return None
    detail = "".join(lines[detail_at:])
    # A cell may contain non-contiguous weeks such as "1-3周,5-16周".
    # Preserve every declared range; the web timetable filters with this data.
    week_ranges = re.findall(r"(\d+(?:-\d+)?)周", detail)
    weeks = ",".join(dict.fromkeys(week_ranges))
    sections = list(SECTION.finditer(detail))
    location = detail[sections[-1].end():] if sections else ""
    location = re.sub(r"^(?:无|[,，])", "", location).strip(" ,，")
    actual_day = weekday(detail) or column_day
    actual_section = section_label(detail) or row_section
    if not actual_day or not actual_section:
        return None
    return {
        "course_name": name[:100],
        "weekday": actual_day,
        "start_time": actual_section,
        "end_time": actual_section,
        "location": location[:100],
        "weeks": weeks or "1-16",
        "color": "#c96d42",
    }


def extract(pdf_path):
    entries = []
    seen = set()
    with pdfplumber.open(pdf_path) as document:
        first_page_text = document.pages[0].extract_text() or ""
        semester_match = re.search(r"(\d{4}-\d{4})学年第?([12一二])学期", first_page_text)
        semester_key = ""
        if semester_match:
            term_number = {"一": "1", "二": "2"}.get(semester_match.group(2), semester_match.group(2))
            semester_key = f"{semester_match.group(1)}-{term_number}"
        for page in document.pages:
            for table in page.extract_tables():
                if not table:
                    continue
                header_index = next((row_index for row_index, row in enumerate(table)
                                     if row and sum(1 for cell in row if weekday(cell)) >= 3), None)
                if header_index is None:
                    continue
                day_columns = [(index, weekday(cell)) for index, cell in enumerate(table[header_index])]
                day_columns = [(index, day) for index, day in day_columns if day]
                for row in table[header_index + 1:]:
                    if not row:
                        continue
                    row_section = section_label(row[0] if row else "")
                    if not row_section:
                        continue
                    for column, day in day_columns:
                        cell = row[column] if column < len(row) else ""
                        for block in split_course_blocks(cell):
                            entry = course_entry(block, day, row_section)
                            if not entry:
                                continue
                            key = (entry["course_name"], entry["weekday"], entry["start_time"], entry["weeks"], entry["location"])
                            if key not in seen:
                                seen.add(key)
                                entries.append(entry)
    warnings = []
    if entries:
        warnings.append("已按吉林大学“我的课程表”PDF 网格格式识别；请在导入前核对预览。调课信息和周次暂不写入基础课表。")
    else:
        warnings.append("未找到吉林大学课表的“星期 × 节次”网格。请上传教务系统导出的课程表 PDF、Excel 或 CSV。")
    return {"entries": entries, "warnings": warnings, "semester_key": semester_key}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"entries": [], "warnings": ["缺少 PDF 文件"]}, ensure_ascii=False))
        sys.exit(2)
    print(json.dumps(extract(sys.argv[1]), ensure_ascii=False))
