ALTER TABLE `prepared_artifacts` ADD `info` text CONSTRAINT `prepared_info` CHECK (`info` IS NULL OR json_valid(`info`));
