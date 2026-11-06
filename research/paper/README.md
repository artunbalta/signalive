# The preprint

`main.pdf` is the write up of everything in `research/aad` and `research/ext`:
decoder v3 held out by person, story and study; the belief and the spliced
switches; what holding the voice is worth; in the ear against around it;
what the electronics may add; and the clench on four public data sets.

Every number in it is a LaTeX macro written by `make_numbers.py` from the
result files, so the text cannot drift from the data; a result that does not
exist yet prints as ??.

```bash
python3 research/paper/make_numbers.py   # numbers.tex from the result files
python3 research/paper/figures.py        # fig_*.pdf
cd research/paper && tectonic -X compile main.tex
```
