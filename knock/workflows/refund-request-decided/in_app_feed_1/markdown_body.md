{% if data.decision == "approved" %}Your refund request for {{ data.course_title }} was approved{% else %}Your refund request for {{ data.course_title }} was declined{% endif %}
{% if data.excerpt %}
> “{{ data.excerpt }}”
{% endif %}
