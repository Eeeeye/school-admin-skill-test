-- Keep dashboard leave totals scoped to the current user and count full calendar days.
CREATE OR REPLACE FUNCTION get_dashboard_data(_user_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
AS $BODY$

DECLARE
    _user_role_id INTEGER;

    _student_count_current_year INTEGER;
    _student_count_previous_year INTEGER;
    _student_value_comparison INTEGER;
    _student_perc_comparison FLOAT;

    _teacher_count_current_year INTEGER;
    _teacher_count_previous_year INTEGER;
    _teacher_value_comparison INTEGER;
    _teacher_perc_comparison FLOAT;

    _parent_count_current_year INTEGER;
    _parent_count_previous_year INTEGER;
    _parent_value_comparison INTEGER;
    _parent_perc_comparison FLOAT;

    _notices_data JSONB;
    _leave_policies_data JSONB;
    _leave_histories_data JSONB;
    _celebrations_data JSONB;
    _one_month_leave_data JSONB;
BEGIN
    -- user check
    IF NOT EXISTS(SELECT 1 FROM users u WHERE u.id = _user_id) THEN
        RAISE EXCEPTION 'User does not exist';
    END IF;

    SELECT role_id FROM users u WHERE u.id = _user_id into _user_role_id;
    IF _user_role_id IS NULL THEN
        RAISE EXCEPTION 'Role does not exist';
    END IF;

    --student
    IF _user_role_id = 1 THEN
        SELECT COUNT(*) INTO _student_count_current_year
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE t1.role_id = 3
        AND EXTRACT(YEAR FROM t2.admission_dt) = EXTRACT(YEAR FROM CURRENT_DATE);

        SELECT COUNT(*) INTO _student_count_previous_year
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE t1.role_id = 3
        AND EXTRACT(YEAR FROM t2.admission_dt) = EXTRACT(YEAR FROM CURRENT_DATE) - 1;

        _student_value_comparison := _student_count_current_year - _student_count_previous_year;
        IF _student_count_previous_year = 0 THEN
            _student_perc_comparison := 0;
        ELSE
            _student_perc_comparison := (_student_value_comparison::FLOAT / _student_count_previous_year) * 100;
        END IF;

        --teacher
        SELECT COUNT(*) INTO _teacher_count_current_year
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE t1.role_id = 2
        AND EXTRACT(YEAR FROM t2.join_dt) = EXTRACT(YEAR FROM CURRENT_DATE);

        SELECT COUNT(*) INTO _teacher_count_previous_year
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE t1.role_id = 2
        AND EXTRACT(YEAR FROM t2.join_dt) = EXTRACT(YEAR FROM CURRENT_DATE) - 1;

        _teacher_value_comparison := _teacher_count_current_year - _teacher_count_previous_year;
        IF _teacher_count_previous_year = 0 THEN
            _teacher_perc_comparison := 0;
        ELSE
            _teacher_perc_comparison := (_teacher_value_comparison::FLOAT / _teacher_count_previous_year) * 100;
        END IF;

        --parents
        SELECT COUNT(*) INTO _parent_count_current_year
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE EXISTS (SELECT 1 FROM roles parent_role WHERE parent_role.id=t1.role_id AND LOWER(parent_role.name)='parent')
        AND EXTRACT(YEAR FROM t2.join_dt) = EXTRACT(YEAR FROM CURRENT_DATE);

        SELECT COUNT(*) INTO _parent_count_previous_year
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE EXISTS (SELECT 1 FROM roles parent_role WHERE parent_role.id=t1.role_id AND LOWER(parent_role.name)='parent')
        AND EXTRACT(YEAR FROM t2.join_dt) = EXTRACT(YEAR FROM CURRENT_DATE) - 1;

        _parent_value_comparison := _parent_count_current_year - _parent_count_previous_year;
        IF _parent_count_previous_year = 0 THEN
            _parent_perc_comparison := 0;
        ELSE
            _parent_perc_comparison := (_parent_value_comparison::FLOAT / _parent_count_previous_year) * 100;
        END IF;
    ELSE
        _student_count_current_year := 0::INTEGER;
        _student_perc_comparison := 0::FLOAT;
        _student_value_comparison := 0::INTEGER;

        _teacher_count_current_year := 0::INTEGER;
        _teacher_perc_comparison := 0::FLOAT;
        _teacher_value_comparison := 0::INTEGER;

        _parent_count_current_year := 0::INTEGER;
        _parent_perc_comparison := 0::FLOAT;
        _parent_value_comparison := 0::INTEGER;
    END IF;

    -- get notices
    SELECT
        COALESCE(JSON_AGG(row_to_json(t)), '[]'::json)
    INTO _notices_data
    FROM (
        SELECT *
        FROM get_notices(_user_id) AS t
        WHERE t."statusId" <> 6
        LIMIT 5
    ) AS t;


    --leave polices
    WITH _leave_policies_query AS (
        SELECT
            t2.id,
            t2.name,
            COALESCE(SUM(
                CASE WHEN t3.status = 2 THEN
                    (t3.to_dt - t3.from_dt) + 1
                ELSE 0
                END
            ), 0) AS "totalDaysUsed"
        FROM user_leave_policy t1
        JOIN leave_policies t2 ON t1.leave_policy_id = t2.id
        LEFT JOIN user_leaves t3 ON t1.leave_policy_id = t3.leave_policy_id AND t1.user_id = t3.user_id
        WHERE t1.user_id = _user_id AND t2.is_active = true
        GROUP BY t2.id, t2.name
    )
    SELECT
        COALESCE(JSON_AGG(row_to_json(t)), '[]'::json)
    INTO _leave_policies_data
    FROM _leave_policies_query AS t;


    --leave history
    WITH _leave_history_query AS (
        SELECT
            t1.id,
            t2.name AS policy,
            t1.leave_policy_id AS "policyId",
            t1.from_dt AS "from",
            t1.to_dt AS "to",
            t1.note,
            t3.name AS status,
            t1.submitted_dt AS "submitted",
            t1.updated_dt AS "updated",
            t1.approved_dt AS "approved",
            t4.name AS approver,
            t5.name AS user,
            (t1.to_dt - t1.from_dt) + 1 AS days
        FROM user_leaves t1
        JOIN leave_policies t2 ON t1.leave_policy_id = t2.id
        JOIN leave_status t3 ON t1.status = t3.id
        LEFT JOIN users t4 ON t1.approver_id = t4.id
        JOIN users t5 ON t1.user_id = t5.id
        WHERE (
            _user_role_id = 1
            And 1=1
        ) OR (
            _user_role_id != 1
            AND t1.user_id = _user_id
        )
        ORDER BY submitted_dt DESC
        LIMIT 5
    )
    SELECT
        COALESCE(JSON_AGG(row_to_json(t)), '[]'::json)
    INTO _leave_histories_data
    FROM _leave_history_query AS t;


    --celebrations
    WITH _celebrations AS (
        SELECT 
            t1.id AS "userId", 
            t1.name AS user, 
            'Happy Birthday!' AS event, 
            t2.dob AS "eventDate"
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE t2.dob IS NOT NULL
        AND (
            t2.dob + (EXTRACT(YEAR FROM age(now(), t2.dob)) + 1) * INTERVAL '1 year'
            BETWEEN now() AND now() + INTERVAL '90 days'
        )

        UNION ALL

        SELECT 
            t1.id AS "userId", 
            t1.name AS user, 
            'Happy ' ||
                CASE
                    WHEN t1.role_id = 3 THEN
                        EXTRACT(YEAR FROM age(now(), t2.admission_dt))
                    ELSE
                        EXTRACT(YEAR FROM age(now(), t2.join_dt))
                END || ' Anniversary!' AS event, 
            CASE
                WHEN t1.role_id = 3 THEN
                    t2.admission_dt
                ELSE
                    t2.join_dt
            END AS "eventDate"
        FROM users t1
        JOIN user_profiles t2 ON t1.id = t2.user_id
        WHERE 
        (
            t1.role_id = 3 
            AND t2.admission_dt IS NOT NULL 
            AND age(now(), t2.admission_dt) >= INTERVAL '1 year'
            AND (
                (t2.admission_dt +
                (EXTRACT(YEAR FROM age(now(), t2.admission_dt)) + 1 ) * INTERVAL '1 year')
                BETWEEN now() AND now() + '90 days'
            )
        )
        OR 
        (
            t1.role_id != 3 
            AND t2.join_dt IS NOT NULL 
            AND age(now(), t2.join_dt) >= INTERVAL '1 year'
            AND (
                (t2.join_dt +
                (EXTRACT(YEAR FROM age(now(), t2.join_dt)) + 1 ) * INTERVAL '1 year')
                BETWEEN now() AND now() + '90 days'
            )
        )
    )
    SELECT
        COALESCE(JSON_AGG(row_to_json(t) ORDER BY TO_CHAR(t."eventDate", 'MM-DD') ), '[]'::json)
    INTO _celebrations_data
    FROM _celebrations AS t;


    --who is out this week
    WITH _month_dates AS (
        SELECT 
            DATE_TRUNC('day', now()) AS day_start, 
            DATE_TRUNC('day', now()) + INTERVAL '30 days' AS day_end
    )
    SELECT
        COALESCE(JSON_AGG(row_to_json(t)), '[]'::json)
    INTO _one_month_leave_data
    FROM (
        SELECT
            t1.id AS "userId",
            t1.name AS user,
            t2.from_dt AS "fromDate",
            t2.to_dt AS "toDate",
            t3.name AS "leaveType"
        FROM users t1
        JOIN user_leaves t2 ON t1.id = t2.user_id
        JOIN leave_policies t3 ON t2.leave_policy_id = t3.id
        JOIN _month_dates t4
        ON
            t2.from_dt <= t4.day_end
            AND t2.to_dt >= t4.day_start
        WHERE t2.status = 2
    )t;

    -- Build and return the final JSON object
    RETURN JSON_BUILD_OBJECT(
        'students', JSON_BUILD_OBJECT(
            'totalNumberCurrentYear', _student_count_current_year,
            'totalNumberPercInComparisonFromPrevYear', _student_perc_comparison,
            'totalNumberValueInComparisonFromPrevYear', _student_value_comparison
        ),
        'teachers', JSON_BUILD_OBJECT(
            'totalNumberCurrentYear', _teacher_count_current_year,
            'totalNumberPercInComparisonFromPrevYear', _teacher_perc_comparison,
            'totalNumberValueInComparisonFromPrevYear', _teacher_value_comparison
        ),
        'parents', JSON_BUILD_OBJECT(
            'totalNumberCurrentYear', _parent_count_current_year,
            'totalNumberPercInComparisonFromPrevYear', _parent_perc_comparison,
            'totalNumberValueInComparisonFromPrevYear', _parent_value_comparison
        ),
        'notices', _notices_data,
        'leavePolicies', _leave_policies_data,
        'leaveHistory', _leave_histories_data,
        'celebrations', _celebrations_data,
        'oneMonthLeave', _one_month_leave_data
    );
END;
$BODY$;
